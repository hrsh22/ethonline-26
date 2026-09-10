// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CcaBidEscrow} from "../src/launch/CcaBidEscrow.sol";
import {
    CcaBidEscrowFactory,
    ICcaLaunchEscrowRegistrar
} from "../src/launch/CcaBidEscrowFactory.sol";

contract CcaEscrowTestToken {
    mapping(address account => uint256 balance) public balanceOf;

    bool public launched;
    bool public returnFalse;
    bool public reenterOnTransfer;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    address public reentryTarget;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setLaunched(bool launched_) external {
        launched = launched_;
    }

    function setReturnFalse(bool returnFalse_) external {
        returnFalse = returnFalse_;
    }

    function setReentry(address target) external {
        reentryTarget = target;
        reenterOnTransfer = true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (returnFalse) return false;

        if (reenterOnTransfer) {
            reenterOnTransfer = false;
            reentryAttempted = true;
            (reentrySucceeded,) = reentryTarget.call(abi.encodeCall(CcaBidEscrow.withdrawFuel, ()));
        }

        uint256 available = balanceOf[msg.sender];
        require(available >= amount, "insufficient test balance");
        balanceOf[msg.sender] = available - amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract CcaEscrowRegistrarMock is ICcaLaunchEscrowRegistrar {
    mapping(address escrow => bool registered) public isRegistered;
    uint256 public registrationCount;
    bool public rejectRegistration;

    function setRejectRegistration(bool reject) external {
        rejectRegistration = reject;
    }

    function registerLaunchEscrow(address escrow) external {
        if (rejectRegistration) revert("registration rejected");
        require(!isRegistered[escrow], "duplicate registration");
        isRegistered[escrow] = true;
        ++registrationCount;
    }
}

contract CcaEscrowWithdrawalCaller {
    function withdrawCurrency(CcaBidEscrow escrow) external returns (uint256) {
        return escrow.withdrawCurrency();
    }

    function withdrawFuel(CcaBidEscrow escrow) external returns (uint256) {
        return escrow.withdrawFuel();
    }
}

contract CcaBidEscrowTest {
    address private constant _BENEFICIARY = address(0xBEEF);

    function testFactoryDeploysRegistersAndReusesOneDeterministicEscrow() external {
        (
            CcaEscrowTestToken fuel,
            CcaEscrowTestToken currency,
            CcaEscrowRegistrarMock registrar,
            CcaBidEscrowFactory factory
        ) = _deployFactory();

        address predicted = factory.predictEscrow(_BENEFICIARY);
        address deployed = factory.deployEscrow(_BENEFICIARY);
        address repeated = factory.deployEscrow(_BENEFICIARY);
        CcaBidEscrow escrow = CcaBidEscrow(deployed);

        require(deployed == predicted, "CREATE2 prediction mismatch");
        require(repeated == deployed, "factory did not reuse escrow");
        require(factory.escrowOf(_BENEFICIARY) == deployed, "forward lookup missing");
        require(factory.beneficiaryOf(deployed) == _BENEFICIARY, "reverse lookup missing");
        require(factory.isEscrow(deployed), "escrow not registered in factory");
        require(registrar.isRegistered(deployed), "coordinator registration missing");
        require(registrar.registrationCount() == 1, "coordinator registration repeated");
        require(escrow.beneficiary() == _BENEFICIARY, "beneficiary drifted");
        require(address(escrow.fuel()) == address(fuel), "fuel drifted");
        require(address(escrow.currency()) == address(currency), "currency drifted");
    }

    function testCoordinatorRegistrationFailureRollsBackDeploymentAndCanRetry() external {
        (,,, CcaBidEscrowFactory factory) = _deployFactoryWithRejectedRegistration();
        CcaEscrowRegistrarMock registrar = CcaEscrowRegistrarMock(address(factory.registrar()));
        address predicted = factory.predictEscrow(_BENEFICIARY);

        (bool deployed,) =
            address(factory).call(abi.encodeCall(CcaBidEscrowFactory.deployEscrow, (_BENEFICIARY)));
        require(!deployed, "rejected registration succeeded");
        require(predicted.code.length == 0, "failed deployment left escrow code");
        require(factory.escrowOf(_BENEFICIARY) == address(0), "failed deployment left mapping");
        require(!factory.isEscrow(predicted), "failed deployment registered escrow");

        registrar.setRejectRegistration(false);
        require(factory.deployEscrow(_BENEFICIARY) == predicted, "retry deployed wrong address");
        require(registrar.isRegistered(predicted), "retry did not register escrow");
    }

    function testCurrencyRefundWithdrawalIsPermissionlessAndIndependentOfFuelLaunch() external {
        (CcaEscrowTestToken fuel, CcaEscrowTestToken currency,, CcaBidEscrowFactory factory) =
            _deployFactory();
        CcaBidEscrow escrow = CcaBidEscrow(factory.deployEscrow(_BENEFICIARY));
        CcaEscrowWithdrawalCaller caller = new CcaEscrowWithdrawalCaller();
        currency.mint(address(escrow), 3.5 ether);
        fuel.mint(address(escrow), 1 ether);

        require(caller.withdrawCurrency(escrow) == 3.5 ether, "wrong refund amount");
        require(currency.balanceOf(_BENEFICIARY) == 3.5 ether, "refund missed beneficiary");
        require(currency.balanceOf(address(caller)) == 0, "caller received refund");

        (bool released,) = address(escrow).call(abi.encodeCall(CcaBidEscrow.withdrawFuel, ()));
        require(!released, "fuel released before launch");
        require(fuel.balanceOf(address(escrow)) == 1 ether, "failed release changed fuel");
    }

    function testFuelWithdrawalPreservesFractionalEntitlementAcrossBoundedBatches() external {
        (CcaEscrowTestToken fuel,,, CcaBidEscrowFactory factory) = _deployFactory();
        CcaBidEscrow escrow = CcaBidEscrow(factory.deployEscrow(_BENEFICIARY));
        CcaEscrowWithdrawalCaller caller = new CcaEscrowWithdrawalCaller();
        fuel.setLaunched(true);
        fuel.mint(address(escrow), 130.75 ether);

        require(caller.withdrawFuel(escrow) == 64 ether, "first batch was not bounded");
        require(fuel.balanceOf(_BENEFICIARY) == 64 ether, "first batch wrong");
        require(caller.withdrawFuel(escrow) == 64 ether, "second batch was not bounded");
        require(fuel.balanceOf(_BENEFICIARY) == 128 ether, "second batch wrong");
        require(caller.withdrawFuel(escrow) == 2.75 ether, "fractional remainder lost");
        require(fuel.balanceOf(_BENEFICIARY) == 130.75 ether, "entitlement not reconciled");
        require(fuel.balanceOf(address(escrow)) == 0, "fuel remained in escrow");
        require(caller.withdrawFuel(escrow) == 0, "empty withdrawal was not idempotent");
    }

    function testFalseReturnTokensLeaveFundsRetryable() external {
        (CcaEscrowTestToken fuel, CcaEscrowTestToken currency,, CcaBidEscrowFactory factory) =
            _deployFactory();
        CcaBidEscrow escrow = CcaBidEscrow(factory.deployEscrow(_BENEFICIARY));
        fuel.setLaunched(true);
        fuel.mint(address(escrow), 2 ether);
        currency.mint(address(escrow), 4 ether);

        fuel.setReturnFalse(true);
        (bool fuelReleased,) = address(escrow).call(abi.encodeCall(CcaBidEscrow.withdrawFuel, ()));
        require(!fuelReleased, "false-return fuel succeeded");
        require(fuel.balanceOf(address(escrow)) == 2 ether, "fuel became unretryable");
        fuel.setReturnFalse(false);
        require(escrow.withdrawFuel() == 2 ether, "fuel retry failed");

        currency.setReturnFalse(true);
        (bool currencyReleased,) =
            address(escrow).call(abi.encodeCall(CcaBidEscrow.withdrawCurrency, ()));
        require(!currencyReleased, "false-return currency succeeded");
        require(currency.balanceOf(address(escrow)) == 4 ether, "refund became unretryable");
        currency.setReturnFalse(false);
        require(escrow.withdrawCurrency() == 4 ether, "refund retry failed");
    }

    function testFuelTransferCannotReenterAnotherWithdrawal() external {
        (CcaEscrowTestToken fuel,,, CcaBidEscrowFactory factory) = _deployFactory();
        CcaBidEscrow escrow = CcaBidEscrow(factory.deployEscrow(_BENEFICIARY));
        fuel.setLaunched(true);
        fuel.mint(address(escrow), 65 ether);
        fuel.setReentry(address(escrow));

        require(escrow.withdrawFuel() == 64 ether, "outer withdrawal failed");
        require(fuel.reentryAttempted(), "token did not attempt reentry");
        require(!fuel.reentrySucceeded(), "withdrawal reentry succeeded");
        require(fuel.balanceOf(address(escrow)) == 1 ether, "reentry changed batch accounting");
        require(fuel.balanceOf(_BENEFICIARY) == 64 ether, "outer payout wrong");
    }

    function testWrongTokenDirectTransferCannotBeRedirectedThroughEscrow() external {
        (CcaEscrowTestToken fuel,,, CcaBidEscrowFactory factory) = _deployFactory();
        CcaEscrowTestToken wrongToken = new CcaEscrowTestToken();
        CcaBidEscrow escrow = CcaBidEscrow(factory.deployEscrow(_BENEFICIARY));
        fuel.setLaunched(true);
        wrongToken.mint(address(escrow), 7 ether);

        escrow.withdrawCurrency();
        escrow.withdrawFuel();
        require(wrongToken.balanceOf(address(escrow)) == 7 ether, "wrong token was moved");
        require(wrongToken.balanceOf(_BENEFICIARY) == 0, "wrong token reached beneficiary");

        (bool arbitraryCall,) = address(escrow)
            .call(
                abi.encodeWithSignature(
                    "execute(address,bytes)",
                    address(wrongToken),
                    abi.encodeWithSignature("transfer(address,uint256)", _BENEFICIARY, 7 ether)
                )
            );
        require(!arbitraryCall, "escrow exposed arbitrary execution");
    }

    function _deployFactory()
        private
        returns (
            CcaEscrowTestToken fuel,
            CcaEscrowTestToken currency,
            CcaEscrowRegistrarMock registrar,
            CcaBidEscrowFactory factory
        )
    {
        fuel = new CcaEscrowTestToken();
        currency = new CcaEscrowTestToken();
        registrar = new CcaEscrowRegistrarMock();
        factory = new CcaBidEscrowFactory(address(fuel), address(currency), address(registrar));
    }

    function _deployFactoryWithRejectedRegistration()
        private
        returns (
            CcaEscrowTestToken fuel,
            CcaEscrowTestToken currency,
            CcaEscrowRegistrarMock registrar,
            CcaBidEscrowFactory factory
        )
    {
        (fuel, currency, registrar, factory) = _deployFactory();
        registrar.setRejectRegistration(true);
    }
}
