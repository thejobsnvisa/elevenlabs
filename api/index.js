require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");

/* ===========================
   ENV
=========================== */

const API_KEY = process.env.ELEVENLABS_API_KEY;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/* ===========================
   GOOGLE SERVICE ACCOUNT
=========================== */

const serviceAccountPath = path.join(
  __dirname,
  "service-account.json"
);

const serviceAccountEnv =
  process.env.GOOGLE_SERVICE_ACCOUNT;

if (!serviceAccountEnv) {
  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT env variable missing"
  );
}

if (!fs.existsSync(serviceAccountPath)) {
  fs.writeFileSync(
    serviceAccountPath,
    serviceAccountEnv
  );
}

const auth = new google.auth.GoogleAuth({
  keyFile: serviceAccountPath,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

/* ==========================
   EXTRACT DATA
========================== */

function extractData(text) {
  if (!text) return null;

  const lower = text.toLowerCase();

  /* NAME */

  let client_name = "";

  const ignoreWords = [
    "thank",
    "thanks",
    "yeah",
    "yes",
    "hello",
    "hi",
    "interested",
    "callback",
    "visa",
    "work",
    "student",
    "pr",
    "india",
    "australia",
    "client",
    "agent",
    "growmore",
    "immigration",
  ];

  const patterns = [
    /name[:\s]+([A-Za-z ]+)/i,
    /my name is ([A-Za-z ]+)/i,
    /this is ([A-Za-z ]+)/i,
    /i am ([A-Za-z ]+)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);

    if (m?.[1]) {
      const candidate = m[1].trim();

      if (
        candidate.length > 2 &&
        !ignoreWords.includes(
          candidate.toLowerCase()
        )
      ) {
        client_name = candidate;
        break;
      }
    }
  }

  /* fallback from email */

  let client_email = "";

  const email =
    text.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    );

  if (email) {
    client_email = email[0].toLowerCase();

    if (!client_name) {
      client_name =
        client_email
          .split("@")[0]
          .replace(/[0-9._-]/g, "");
    }
  }

  /* phone */

  let client_phone = "";

  const phones =
    text.match(
      /\+?\d[\d\s()-]{8,20}\d/g
    ) || [];

  for (const p of phones) {
    const clean = p.replace(/\D/g, "");

    if (
      clean.length >= 10 &&
      clean.length <= 15
    ) {
      client_phone = clean;
      break;
    }
  }

  /* country */

  let caller_country = "";

  if (lower.includes("india")) {
    caller_country = "india";
  }

  if (lower.includes("australia")) {
    caller_country = "australia";
  }

  /* inquiry */

  let inquiry = "general inquiry";

  if (/pr|189|190|491|pathway/i.test(lower)) {
    inquiry = "pr pathways";
  } else if (/work|482|186/i.test(lower)) {
    inquiry = "work visa";
  } else if (/student/i.test(lower)) {
    inquiry = "student visa";
  } else if (/visitor|600/i.test(lower)) {
    inquiry = "visitor visa";
  }

  /* next step */

  let next_step_taken =
    "follow_up_required";

  if (
    /callback|free callback/i.test(lower)
  ) {
    next_step_taken =
      "free_callback";
  }

  if (
    /paid consultation|payment|paid/i.test(
      lower
    )
  ) {
    next_step_taken =
      "paid_consultation";
  }

  return {
    caller_type: "new_client",
    client_name,
    client_email,
    client_phone,
    inquiry,
    next_step_taken,
    caller_country,
  };
}

/* ==========================
   GOOGLE SHEET
========================== */

async function appendToSheet(data) {
  const client =
    await auth.getClient();

  const sheets =
    google.sheets({
      version: "v4",
      auth: client,
    });

  await sheets.spreadsheets.values.append(
    {
      spreadsheetId:
        SHEET_ID,
      range:
        "Sheet1!A:G",
      valueInputOption:
        "RAW",
      requestBody: {
        values: [[
          data.caller_type,
          data.client_name,
          data.client_email,
          data.client_phone,
          data.inquiry,
          data.next_step_taken,
          data.caller_country,
        ]],
      },
    }
  );
}

/* ==========================
   ELEVENLABS API
========================== */

async function getConversation(id) {
  const res =
    await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations/${id}`,
      {
        headers: {
          "xi-api-key":
            API_KEY,
        },
      }
    );

  return res.data;
}

/* ==========================
   API HANDLER
========================== */

module.exports =
  async (req, res) => {
    try {
      const {
        conversation_id,
      } = req.body;

      if (
        !conversation_id
      ) {
        return res
          .status(400)
          .json({
            error:
              "conversation_id missing",
          });
      }

      const details =
        await getConversation(
          conversation_id
        );

      let transcript =
        "";

      if (
        Array.isArray(
          details.transcript
        )
      ) {
        transcript =
          details.transcript
            .filter(m => {
              const role =
                (
                  m.role ||
                  ""
                ).toLowerCase();

              return (
                role.includes(
                  "user"
                ) ||
                role.includes(
                  "human"
                )
              );
            })
            .map(
              m =>
                m.message ||
                m.text ||
                ""
            )
            .join(" ");
      }

      const extracted =
        extractData(
          transcript
        );

      if (extracted) {
        await appendToSheet(
          extracted
        );
      }

      return res.json({
        success: true,
      });
    } catch (err) {
      return res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  };
/* ===========================
   PROCESSED IDS
=========================== */

const FILE_PATH =
  "./processed.json";

function getProcessedIds() {
  try {
    const raw =
      fs.readFileSync(
        FILE_PATH,
        "utf8"
      );

    return JSON.parse(
      raw || "[]"
    );
  } catch {
    return [];
  }
}

function saveProcessed(
  ids
) {
  try {
    fs.writeFileSync(
      FILE_PATH,
      JSON.stringify(
        ids,
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      "❌ saveProcessed error:",
      err.message
    );
  }
}
  
  /* ===========================
   MAIN LOGIC
=========================== */

async function checkConversations() {
  try {
    const processedIds = new Set(
      getProcessedIds()
    );

    const conversations =
      await getConversations();

    console.log(
      `📞 Found ${conversations.length} conversations`
    );

    for (const convo of conversations) {
      const id =
        convo.conversation_id;

      if (
        !id ||
        processedIds.has(id)
      ) {
        continue;
      }

      console.log(
        `📞 Processing ${id}`
      );

      const details =
        await getConversationDetails(
          id
        );

      let transcript =
        "";

      if (
        Array.isArray(
          details.transcript
        )
      ) {
        transcript =
          details.transcript
            .filter((m) => {
              const role = (
                m.role ||
                m.source ||
                ""
              ).toLowerCase();

              return (
                role.includes(
                  "user"
                ) ||
                role.includes(
                  "human"
                )
              );
            })
            .map(
              (m) =>
                m.message ||
                m.text ||
                m.content ||
                ""
            )
            .join(" ")
            .trim();
      }

      console.log(
        "📝 Transcript:",
        transcript
      );

      if (!transcript)
        continue;

      const extracted =
        extractData(
          transcript
        );

      console.log(
        "📦 Extracted:",
        extracted
      );

      if (
        extracted
      ) {
        await appendToSheet(
          extracted
        );

        processedIds.add(
          id
        );

        saveProcessed([
          ...processedIds,
        ]);

        console.log(
          `✅ Saved ${id}`
        );
      }
    }
  } catch (err) {
    console.error(
      "❌ checkConversations Error:",
      err.message
    );
  }
}

console.log(
  "🚀 App started"
);

(async () => {
  try {
    console.log(
      "📞 Checking conversations..."
    );

    await checkConversations();

    console.log(
      "✅ Finished"
    );
  } catch (err) {
    console.error(
      "❌ Error:",
      err
    );
  }
})();