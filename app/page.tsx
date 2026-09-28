"use client";
import { useEffect, useMemo, useState } from "react";
import type { EditorialAnalysis, Article } from "@/lib/types";

const triggerNames:Record<string,string> = {breaking:"Último momento",noticia:"Noticia",declaraciones:"Declaraciones",mercado:"Mercado",previa:"Previa",post:"Post partido",actualizacion:"Actualización",analisis:"Análisis"};

async function postJson(url:string, payload:unknown){
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const raw=await r.text();
  let d:any=null;
  try{d=JSON.parse(raw)}catch{}
  if(!r.ok||!d){
    if(d?.error)throw new Error(d.error);
    if(r.status===504||/FUNCTION_INVOCATION_TIMEOUT/i.test(raw))throw new Error("El servidor tardó demasiado (timeout). Probá con un modelo más rápido o menos URLs.");
    throw new Error(`Error del servidor (${r.status}).`);
  }
  return d;
}

export default function Home(){
  const [input,setInput]=useState(""); const [context,setContext]=useState(""); const [urls,setUrls]=useState("");
  const [analysis,setAnalysis]=useState<EditorialAnalysis|null>(null); const [article,setArticle]=useState<Article|null>(null);
  const [loading,setLoading]=useState<""|"analyze"|"generate">(""); const [error,setError]=useState(""); const [tier,setTier]=useState("auto");
  const [angle,setAngle]=useState(0); const [copied,setCopied]=useState(false);
  const [providers,setProviders]=useState<Record<string,boolean>|null>(null);
  useEffect(()=>{fetch("/api/status").then(r=>r.json()).then(d=>setProviders(d.providers)).catch(()=>setProviders(null))},[]);
  const anyProvider=!providers||Object.values(providers).some(Boolean);
  const urlList=useMemo(()=>urls.split(/\n|,|\s+/).map(x=>x.trim()).filter(Boolean),[urls]);
  async function analyze(){setError("");setArticle(null);setAnalysis(null);setAngle(0);setLoading("analyze");try{const d=await postJson("/api/analyze",{input,context,urls:urlList});setAnalysis(d.analysis);}catch(e:any){setError(e.message)}finally{setLoading("")}}
  async function generate(){if(!analysis)return;setError("");setLoading("generate");try{const angles=analysis.suggestedAngles||[];const edited={...analysis,suggestedAngles:angles.length?[angles[angle]??angles[0],...angles.filter((_,i)=>i!==angle)]:[]};const d=await postJson("/api/generate",{input,context,analysis:edited,forceTier:tier});setArticle(d.article);}catch(e:any){setError(e.message)}finally{setLoading("")}}
  async function copyArticle(){if(!article)return;const text=`${article.title}\n\n${article.deck}\n\n${article.body}`;try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove()}setCopied(true);setTimeout(()=>setCopied(false),1800)}
  return <main>
    <header className="top"><div><span className="eyebrow">LAB · REDACCIÓN</span><h1>Mesa</h1></div><div className="status"><span className={anyProvider?"dot":"dot off"}/> {providers?(anyProvider?Object.entries(providers).filter(([,v])=>v).map(([k])=>k).join(" · "):"Sin IA configurada"):"IA editorial"}</div></header>
    <section className="hero"><div><p className="kicker">De una señal a una nota</p><h2>Contá qué pasó.<br/><em>La mesa ordena el resto.</em></h2><p className="lead">Pegá una noticia, una declaración, un resultado, una actualización o una URL. Primero separa hechos, dudas y enfoque; después redacta y revisa.</p></div></section>
    <section className="composer card">
      <label>¿Qué pasó?</label><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Ej.: River confirmó que... / Terminó Boca 2-1... / Pegá acá un cable o una declaración"/>
      <details><summary>+ Agregar contexto y fuentes</summary><div className="detailsGrid"><div><label>Contexto propio</label><textarea className="small" value={context} onChange={e=>setContext(e.target.value)} placeholder="Qué sabemos, qué no afirmar, enfoque deseado..."/></div><div><label>URLs · una por línea</label><textarea className="small" value={urls} onChange={e=>setUrls(e.target.value)} placeholder="https://..."/></div></div></details>
      <button className="primary" disabled={input.trim().length<5||!!loading} onClick={analyze}>{loading==="analyze"?"Analizando…":"Analizar historia →"}</button>
      {!anyProvider&&<p className="error">No hay claves de IA configuradas en el servidor. Agregá GEMINI_API_KEY, GROQ_API_KEY o ANTHROPIC_API_KEY (en .env.local o en Vercel → Settings → Environment Variables) y reiniciá/redeployá.</p>}
      {error&&<p className="error">{error}</p>}
    </section>
    {analysis&&<section className="desk">
      <div className="deskHead"><div><span className="badge">{triggerNames[analysis.trigger]||analysis.label}</span><h3>{analysis.headline}</h3><p>{analysis.summary}</p></div><div className={`risk ${analysis.risk}`}>Riesgo {analysis.risk}<strong>{analysis.complexity}/10</strong></div></div>
      <div className="grid3">
        <div className="panel good"><h4>Confirmado</h4>{analysis.confirmedFacts?.map((x,i)=><p key={i}>✓ {x}</p>)}</div>
        <div className="panel ask"><h4>Falta saber</h4>{analysis.openQuestions?.map((x,i)=><p key={i}>? {x}</p>)}</div>
        <div className="panel warn"><h4>Cuidado</h4>{analysis.cautions?.map((x,i)=><p key={i}>! {x}</p>)}</div>
      </div>
      <div className="angles card"><div><h4>Enfoque</h4><p className="muted">Elegí cuál debe conducir la nota.</p></div><div className="angleList">{!analysis.suggestedAngles?.length&&<p className="muted">El modelo no propuso enfoques.</p>}{analysis.suggestedAngles?.map((x,i)=><button key={i} className={angle===i?"angle active":"angle"} onClick={()=>setAngle(i)}><span>{String(i+1).padStart(2,"0")}</span>{x}</button>)}</div></div>
      <div className="generateBar"><div><label>Modelo</label><select value={tier} onChange={e=>setTier(e.target.value)}><option value="auto">Automático · {analysis.recommendedTier}</option><option value="free_fast">Gratis · rápido</option><option value="free_strong">Gratis · fuerte</option><option value="premium">Premium</option></select><small>{analysis.reason}</small></div><button className="primary dark" disabled={!!loading} onClick={generate}>{loading==="generate"?"Redactando y revisando…":"Armar nota →"}</button></div>
    </section>}
    {article&&<section className="articleWrap">
      <div className="articleMain"><div className="articleMeta"><span>{article.section}</span><span>{article.model.provider} · {article.model.model}</span></div><h2 className="articleTitle">{article.title}</h2><p className="deck">{article.deck}</p><div className="body">{(article.body||"").split(/\n\s*\n+|\n/).filter(p=>p.trim()).map((p,i)=><p key={i}>{p}</p>)}</div></div>
      <aside><div className="review card"><h4>Control editorial</h4><div className={article.review.approved?"approved":"needs"}>{article.review.approved?"✓ Aprobado":"! Revisar"}</div>{article.review.rewritten&&<p className="muted">Se aplicó una reescritura automática.</p>}{article.review.checks.map((x,i)=><p key={i}>✓ {x}</p>)}{article.review.warnings.map((x,i)=><p key={`w${i}`}>! {x}</p>)}</div><div className="card"><h4>Títulos alternativos</h4>{article.alternatives.length===0&&<p className="muted">Sin alternativas.</p>}{article.alternatives.map((a,i)=><div className="alt" key={i}><div><span>{a.kind}</span><strong>{a.score}</strong></div><p>{a.title}</p></div>)}</div><button className="copy" onClick={copyArticle}>{copied?"✓ Copiada":"Copiar nota"}</button></aside>
    </section>}
    <footer>V1 · Mesa editorial deportiva · Los datos recientes deben estar respaldados por el input o sus fuentes.</footer>
  </main>
}
