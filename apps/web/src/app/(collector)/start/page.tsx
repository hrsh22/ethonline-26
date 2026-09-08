import { redirect } from "next/navigation";

/** Compatibility only: collecting has no onboarding stages. */
export default function StartPage() {
  redirect("/fleet");
}
