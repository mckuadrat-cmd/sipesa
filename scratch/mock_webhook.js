async function run() {
  const url = "https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server/webhooks/meta";
  
  const payload = {
    "entry": [
      {
        "changes": [
          {
            "value": {
              "messaging_product": "whatsapp",
              "metadata": {
                "display_phone_number": "6285177824669",
                "phone_number_id": "902200319652029"
              },
              "contacts": [
                {
                  "profile": {
                    "name": "Test Webhook User"
                  },
                  "wa_id": "628123456789"
                }
              ],
              "messages": [
                {
                  "from": "628123456789",
                  "id": "wamid.mock_message_id_" + Math.random().toString(36).substring(7),
                  "timestamp": Math.floor(Date.now() / 1000).toString(),
                  "text": {
                    "body": "Hello webhook test - " + new Date().toISOString()
                  },
                  "type": "text"
                }
              ]
            },
            "field": "messages"
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  console.log("STATUS:", response.status);
  console.log("RESPONSE:", text);
}

run();
