import { RepairWizard } from "@/components/setup/repair-wizard";
import { createClient } from "@/lib/supabase/server";

export default async function RepairPage({ searchParams }: { searchParams: Promise<{ source?:string }> }) {
  const { source } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data = [] } = user ? await supabase.from("leagues").select("id,name,initial_budget,min_bid").eq("owner_id", user.id).eq("status", "COMPLETED").order("created_at", { ascending: false }) : { data: [] };
  return <RepairWizard sources={data ?? []} initialSourceId={source} />;
}
