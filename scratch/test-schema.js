fetch("https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server/dev/check-columns", {
  headers: {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU"
  }
})
.then(res => res.json())
.then(data => {
  console.log("Response data:", data);
})
.catch(err => console.error("Error:", err));
