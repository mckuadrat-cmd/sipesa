import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://gwokwhznesggqoqrzaet.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU";

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from("wa_templates")
    .select("*")
    .ilike("name", "surat_penerimaan")
    .maybeSingle();

  if (error) {
    console.error("Error fetching template:", error);
    return;
  }

  console.log("TEMPLATE DETAILS:", JSON.stringify(data, null, 2));
}

run();
