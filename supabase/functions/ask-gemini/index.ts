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
    ? "You are a concise, practical project-management assistant inside the Milemaps app. The message you receive always starts with real project/checkpoint data pulled directly from the user's account — treat every line of it as true and already existing; never say the project has no name or no checkpoints if any are listed. Reference specific checkpoint titles and statuses from that data in your answer. Answer the question in 2-5 short sentences, in English. Be specific and actionable, not generic."
    : "คุณเป็นผู้ช่วยด้านการบริหารโปรเจกต์ในแอป Milemaps ข้อความที่ได้รับจะขึ้นต้นด้วยข้อมูลโปรเจกต์/checkpoint จริงที่ดึงมาจากบัญชีผู้ใช้เสมอ — ให้ถือว่าทุกบรรทัดเป็นข้อมูลจริงที่มีอยู่แล้ว ห้ามบอกว่าโปรเจกต์ไม่มีชื่อหรือไม่มี checkpoint ถ้ามีข้อมูลระบุไว้ ให้อ้างอิงชื่อ checkpoint และสถานะที่ให้มาโดยตรงในคำตอบ ตอบคำถามแบบกระชับ 2-5 ประโยค เป็นภาษาไทย ให้คำแนะนำที่นำไปใช้ได้จริง ไม่พูดกว้าง ๆ";
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
    const userText = `=== Real project data (already exists, treat as fact) ===\n${trimmedContext || "(no additional details)"}\n=== End of project data ===\n\nUser's question: ${trimmedQuestion}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: systemPrompt(lang === "en" ? "en" : "th") }] },
          // A small nonzero thinking budget (rather than 0) lets the model actually attend to
          // the supplied project context instead of ignoring it — thinkingBudget: 0 answered
          // fast but sometimes claimed the given checkpoints didn't exist. maxOutputTokens is
          // generous so thinking + the visible answer both fit without truncation (reproduced
          // and fixed during testing: answers were previously cut off mid-sentence).
          generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 512 } },
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
