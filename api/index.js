require("dotenv").config();

const fs = require("fs");
const axios = require("axios");
const { google } = require("googleapis");

/* ===========================
   ENV
=========================== */

const API_KEY = process.env.ELEVENLABS_API_KEY;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/* ===========================
   GOOGLE AUTH
=========================== */

const auth = new google.auth.GoogleAuth({
  keyFile: "service-account.json",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

/* ===========================
   VERCEL SAFE FILE
=========================== */

const FILE_PATH =
  "/tmp/processed.json";

function getProcessedIds() {
  try {
    return JSON.parse(
      fs.readFileSync(
        FILE_PATH,
        "utf8"
      )
    );
  } catch {
    return [];
  }
}

function saveProcessed(ids) {
  fs.writeFileSync(
    FILE_PATH,
    JSON.stringify(ids)
  );
}

/* ===========================
   ELEVENLABS API
=========================== */

async function getConversations() {
  const res =
    await axios.get(
      "https://api.elevenlabs.io/v1/convai/conversations",
      {
        headers: {
          "xi-api-key":
            API_KEY,
        },
      }
    );

  return (
    res.data.conversations ||
    []
  );
}

async function getConversationDetails(
  id
) {
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

/* ===========================
   EXTRACT DATA
=========================== */

function extractData(text) {
  if (!text) return null;

  const lower =
    text.toLowerCase();

  /* -------------------------
     BAD WORDS
  ------------------------- */

  const ignoreWords =
    new Set([
      "thank",
      "thanks",
      "yeah",
      "yes",
      "hello",
      "hi",
      "temporary",
      "australian",
      "interested",
      "interested for",
      "interested in",
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
      "correct",
      "details",
      "granari",
      "hearing",
      "the correct",
      "the correct details",
    ]);

  /* -------------------------
     EMAIL
  ------------------------- */

  let client_email =
    "";

  const email =
    text.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    );

  if (email) {
    client_email =
      email[0].toLowerCase();
  }

  /* spoken email */

  if (!client_email) {
    const spoken =
      lower.match(
        /([a-z0-9._%+-]+)\s+(?:at|at the rate)\s+([a-z0-9.-]+)\s+(?:dot|\.)\s+([a-z]{2,10})/i
      );

    if (spoken) {
      client_email =
        `${spoken[1]}@${spoken[2]}.${spoken[3]}`
          .replace(/\s/g, "")
          .toLowerCase();
    }
  }

  /* -------------------------
     PHONE
  ------------------------- */

  let client_phone =
    "";

  const phones =
    text.match(
      /\+?\d[\d\s()-]{8,20}\d/g
    ) || [];

  for (const phone of phones) {
    const clean =
      phone.replace(
        /\D/g,
        ""
      );

    if (
      clean.length >=
        10 &&
      clean.length <=
        15
    ) {
      client_phone =
        clean;
      break;
    }
  }

  /* -------------------------
     NAME
  ------------------------- */

  let client_name =
    "";

  const patterns = [
    /name\s*:\s*([A-Za-z ]+)/i,
    /my name is\s+([A-Za-z ]+)/i,
    /this is\s+([A-Za-z ]+)/i,
    /i am\s+([A-Za-z ]+)/i,
    /name:\s*([A-Za-z ]+)/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(
        pattern
      );

    if (
      match?.[1]
    ) {
      const candidate =
        match[1]
          .trim();

      if (
        !ignoreWords.has(
          candidate.toLowerCase()
        )
      ) {
        client_name =
          candidate;
        break;
      }
    }
  }

  /* fallback from email */

  if (
    !client_name &&
    client_email
  ) {
    const fallback =
      client_email
        .split("@")[0]
        .replace(
          /[0-9._-]/g,
          ""
        );

    if (
      fallback.length >=
        3 &&
      !ignoreWords.has(
        fallback.toLowerCase()
      )
    ) {
      client_name =
        fallback
          .charAt(0)
          .toUpperCase() +
        fallback.slice(
          1
        );
    }
  }

  /* -------------------------
     COUNTRY
  ------------------------- */

  let caller_country =
    "";

  const countries =
    [
      "india",
      "australia",
      "canada",
      "usa",
      "uk",
      "uae",
    ];

  for (const c of countries) {
    if (
      lower.includes(c)
    ) {
      caller_country =
        c;
      break;
    }
  }

  /* -------------------------
     CLIENT TYPE
  ------------------------- */

  const caller_type =
    /existing|follow up|follow-up/i.test(
      lower
    )
      ? "existing_client"
      : "new_client";

  /* -------------------------
     INQUIRY
  ------------------------- */

  let inquiry =
    "general inquiry";

  if (
    /pr|189|190|491|pathway/i.test(
      lower
    )
  ) {
    inquiry =
      "pr pathways";
  } else if (
    /student/i.test(
      lower
    )
  ) {
    inquiry =
      "student visa";
  } else if (
    /work|482|186/i.test(
      lower
    )
  ) {
    inquiry =
      "work visa";
  } else if (
    /visitor|600/i.test(
      lower
    )
  ) {
    inquiry =
      "visitor visa";
  }

  /* -------------------------
     NEXT STEP
  ------------------------- */

  let next_step_taken =
    "follow_up_required";

  if (
    /paid consultation|payment|paid/i.test(
      lower
    )
  ) {
    next_step_taken =
      "paid_consultation";
  } else if (
    /free callback|callback/i.test(
      lower
    )
  ) {
    next_step_taken =
      "free_callback";
  }

  /* -------------------------
     VALIDATION
  ------------------------- */

  const hasLead =
    client_name ||
    client_email ||
    client_phone;

  if (!hasLead)
    return null;

  return {
    caller_type,
    client_name,
    client_email,
    client_phone,
    inquiry,
    next_step_taken,
    caller_country,
  };
}

/* ===========================
   GOOGLE SHEETS
=========================== */

async function appendToSheet(
  data
) {
  const client =
    await auth.getClient();

  const sheets =
    google.sheets({
      version:
        "v4",
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

  console.log(
    "✅ Saved to sheet"
  );
}

/* ===========================
   MAIN LOGIC
=========================== */

async function checkConversations() {
  const processedIds =
    new Set(
      getProcessedIds()
    );

  const conversations =
    await getConversations();

  for (const convo of conversations) {
    const id =
      convo.conversation_id;

    if (
      !id ||
      processedIds.has(
        id
      )
    ) {
      continue;
    }

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

    if (!transcript)
      continue;

    const extracted =
      extractData(
        transcript
      );

    console.log(
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
        "✅ Saved:",
        id
      );
    }
  }
}

/* ===========================
   VERCEL HANDLER
=========================== */

module.exports =
  async (
    req,
    res
  ) => {
    try {
      await checkConversations();

      return res.json(
        {
          success: true,
          message:
            "done",
        }
      );
    } catch (
      err
    ) {
      return res
        .status(500)
        .json({
          error:
            err.message,
        });
    }
  };