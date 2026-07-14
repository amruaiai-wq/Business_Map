// Supabase Edge Function: generate-map
// รับ prompt ข้อความจากผู้ใช้ (ต้องล็อกอินแล้วเท่านั้น — บังคับโดย verify_jwt ของ Supabase เอง)
// แล้วให้ Claude ช่วยร่างแผนผัง checkpoint เริ่มต้น คืนกลับเป็น tree รูปแบบเดียวกับ TEMPLATES ในแอป

import Anthropic from "npm:@anthropic-ai/sdk@0.111.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// รูปแบบต้นไม้ลึกไม่เกิน 2 ชั้น เหมือนเทมเพลตที่เขียนมือไว้ในแอป — structured output ไม่รองรับ schema แบบ recursive
const TREE_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          children: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "children"],
        additionalProperties: false,
      },
    },
  },
  required: ["nodes"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `คุณเป็นที่ปรึกษาธุรกิจที่ช่วยร่างแผนผังความคิด (mind map) checkpoint เริ่มต้นให้ผู้ใช้แอป Milemaps
จากคำอธิบายธุรกิจหรือโปรเจกต์สั้น ๆ ที่ผู้ใช้ให้มา ให้สร้างรายการ checkpoint ประมาณ 6-10 หัวข้อระดับบนสุด
เขียนหัวข้อเป็นภาษาไทยสั้น กระชับ เข้าใจง่าย (ใส่คำอังกฤษในวงเล็บได้ถ้าจำเป็น เช่น "ออกแบบ (Design)")
เฉพาะหัวข้อที่ควรแตกย่อยจริง ๆ (ไม่เกิน 2-4 รายการ) ให้ใส่ children ส่วนหัวข้ออื่นปล่อย children เป็น array ว่าง
อย่าใส่ children ทุกหัวข้อพร่ำเพรื่อ — ใส่เฉพาะจุดที่ช่วยให้ชัดเจนขึ้นจริง ๆ

ตัวอย่างสไตล์ที่ต้องการ (เทมเพลตร้านกาแฟที่มีอยู่แล้วในแอป):
{
  "nodes": [
    { "title": "หาทำเล", "children": [] },
    { "title": "ออกแบบร้าน (Interior)", "children": [] },
    { "title": "เครื่องชง/อุปกรณ์", "children": [{"title":"เครื่องชงกาแฟ"},{"title":"เครื่องบดเมล็ด"}] },
    { "title": "คัดสรรเมล็ดกาแฟ/ซัพพลายเออร์", "children": [] },
    { "title": "ออกแบบเมนู", "children": [] },
    { "title": "จ้าง/ฝึก Barista", "children": [] },
    { "title": "จดทะเบียนธุรกิจ", "children": [] },
    { "title": "การตลาด/เปิดร้าน", "children": [] }
  ]
}

ยึดสไตล์นี้ — ความยาวหัวข้อใกล้เคียงกัน จำนวนหัวข้อใกล้เคียงกัน ไม่ยาวเกินไป ไม่ใส่คำอธิบายเพิ่มนอกเหนือจาก title`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { prompt } = await req.json();
    const trimmed = typeof prompt === "string" ? prompt.trim() : "";
    if (!trimmed || trimmed.length > 300) {
      return new Response(
        JSON.stringify({ error: "กรุณาใส่คำอธิบายธุรกิจ/โปรเจกต์ 1-300 ตัวอักษร" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: TREE_SCHEMA } },
      messages: [{ role: "user", content: trimmed }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("no text block in response");
    }
    const parsed = JSON.parse(textBlock.text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "สร้างแผนผังด้วย AI ไม่สำเร็จ ลองใหม่อีกครั้ง" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
