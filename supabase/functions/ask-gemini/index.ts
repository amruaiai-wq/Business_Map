// Supabase Edge Function: ask-gemini
// รับ context (ข้อมูล checkpoint เดียว หรือทั้งโปรเจกต์) + question จากผู้ใช้ (ต้องล็อกอินแล้วเท่านั้น — บังคับโดย verify_jwt ของ Supabase เอง)
// แล้วส่งต่อให้ Gemini ช่วยตอบ/ให้คำแนะนำแบบข้อความธรรมดา (ไม่ใช่ structured tree เหมือน generate-map)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-flash";

function systemPrompt(lang: string): string {
  return lang === "en"
    ? "You are a concise, practical project-management assistant inside the Milemaps app. Answer the user's question about their project/checkpoint in 2-5 short sentences, in English. Be specific and actionable, not generic."
    : "คุณเป็นผู้ช่วยด้านการบริหารโปรเจกต์ในแอป Milemaps ตอบคำถามของผู้ใช้เกี่ยวกับโปรเจกต์/checkpoint ของเขาแบบกระชับ 2-5 ประโยค เป็นภาษาไทย ให้คำแนะนำที่นำไปใช้ได้จริง ไม่พูดกว้าง ๆ";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { context, question, lang } = await req.json();
    const trimmedContext = typeof context === "string" ? context.trim() : "";
    const trimmedQuestion = typeof question === "string" ? question.trim() : "";
    if (!trimmedQuestion || trimmedQuestion.length > 300 || trimmedContext.length > 6000) {
      return new Response(
        JSON.stringify({ error: "invalid input" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const userText = `ข้อมูลโปรเจกต์ / Project context:\n${trimmedContext}\n\nคำถาม / Question:\n${trimmedQuestion}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: systemPrompt(lang === "en" ? "en" : "th") }] },
          // thinkingBudget: 0 turns off Gemini 2.5's internal "thinking" tokens — without this,
          // reasoning tokens can eat the whole maxOutputTokens budget before any visible text is
          // written, cutting the answer off mid-sentence (reproduced during testing).
          generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error("Gemini API error", geminiRes.status, errBody);
      throw new Error("gemini request failed");
    }

    const data = await geminiRes.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) throw new Error("no answer in gemini response");

    return new Response(JSON.stringify({ answer }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "ask-gemini failed" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
