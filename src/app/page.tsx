import { redirect } from "next/navigation";

export default function Home() {
  // Root route always sends people either to the dashboard (if signed
  // in) or to login — proxy.ts handles the actual auth check.
  redirect("/dashboard");
}
