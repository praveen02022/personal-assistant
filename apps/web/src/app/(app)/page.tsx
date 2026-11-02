import type { Metadata } from "next";
import { HomeView } from "@/components/home/home";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return <HomeView />;
}
