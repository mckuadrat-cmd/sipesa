async function fetchDev() {
  const url = 'https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server/dev/check-columns';
  console.log("Fetching dev check endpoint:", url);
  try {
    const headers = {
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU',
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU'
    };
    const res = await fetch(url, { headers });
    const data = await res.json();
    console.log("\nResponse from server:");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error calling dev check:", err);
  }
}

fetchDev();
