const fetch = require('node-fetch');

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "TEST",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "628123456789",
              phone_number_id: "TEST_PHONE_ID"
            },
            statuses: [
              {
                id: "wamid.TEST",
                status: "delivered",
                timestamp: Math.floor(Date.now() / 1000).toString(),
                recipient_id: "6281230050052",
                biz_opaque_callback_data: "561e0b65-770d-45d1-84f1-093123456789"
              }
            ]
          },
          field: "messages"
        }
      ]
    }
  ]
};

fetch('https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server/webhooks/meta', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}).then(res => console.log('Status:', res.status)).catch(err => console.error(err));
