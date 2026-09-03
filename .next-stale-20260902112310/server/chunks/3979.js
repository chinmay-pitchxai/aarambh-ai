"use strict";exports.id=3979,exports.ids=[3979],exports.modules={23979:(e,t,n)=>{function a(e){return e.replace(/```(?:json)?\s*/gi,"").replace(/```/g,"").trim()}async function r(e,t=1){let n=process.env.GEMINI_API_KEY;if(!n)throw Error("GEMINI_API_KEY not set");for(let a=0;a<=t;a++)try{let t=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${n}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:e}]}],generationConfig:{temperature:.3,maxOutputTokens:1024}}),signal:AbortSignal.timeout(15e3)});if(!t.ok)throw Error(`Gemini API ${t.status}: ${await t.text()}`);let a=await t.json();return a.candidates?.[0]?.content?.parts?.[0]?.text||""}catch(e){if(a===t)throw e;await new Promise(e=>setTimeout(e,500*(a+1)))}throw Error("Gemini unreachable")}n.d(t,{llmLabAgent:()=>o});let o={name:"llm_lab",async execute(e,t){switch(t.log("llm_lab action",{action:e.action}),e.action){case"analyze_transcript":{let t=(e.transcript||[]).map(e=>`${e.role}: ${e.text}`).join("\n"),n=`Analyze this sales call transcript. Return JSON with:
- sentiment: "positive" | "neutral" | "negative"
- summary: one-line summary
- bant: { budget: "yes/no/unknown", authority: "yes/no/unknown", need: "yes/no/unknown", timeline: "specific/vague/none" }
- objections: array of objections raised

Transcript:
${t}`,o=await r(n);try{let e=JSON.parse(a(o));return{sentiment:e.sentiment,summary:e.summary,bant:e.bant}}catch{return{sentiment:"unknown",summary:o.slice(0,200)}}}case"generate_pitch":{let t=`Generate a cold call pitch for:
Company: ${e.lead?.company||"unknown"}
Title: ${e.lead?.title||"unknown"}
Industry: ${e.lead?.industry||"unknown"}
${e.previousContext?`Previous context: ${e.previousContext}`:""}
${e.objection?`Last objection: ${e.objection}`:""}

Keep it under 30 seconds. Be conversational, not scripted.`;return{pitch:(await r(t)).trim()}}case"extract_bant":{let t=(e.transcript||[]).map(e=>`${e.role}: ${e.text}`).join("\n"),n=`Extract BANT from this conversation:
${t}

Return JSON: { budget: "yes/no/unknown", authority: "yes/no/unknown", need: "yes/no/unknown", timeline: "specific/vague/none" }`,o=await r(n);try{return{bant:JSON.parse(a(o))}}catch{return{bant:{budget:"unknown",authority:"unknown",need:"unknown",timeline:"unknown"}}}}case"score_lead":{let t=`Score this lead 1-100 for B2B sales fit:
${JSON.stringify(e.lead,null,2)}

Return JSON: { score: number, band: "hot"|"warm"|"cold", reasons: string[] }`,n=await r(t);try{let e=JSON.parse(a(n));return{score:e.score,band:e.band}}catch{return{score:50,band:"warm"}}}default:return{}}}}}};