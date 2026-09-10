import { redirect } from "next/navigation";

export default function RewardsPage() {
  redirect("/fleet?view=rewards");
}
