import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "./supabase";

const KEYS = { casa:"hub_casa_v1", viajes:"hub_viajes_v3", personal:"hub_personal_v1", laboral:"hub_laboral_v3" };

const C = {
  bg:"#f7f6f3", surface:"#ffffff", surface2:"#f0efe9", border:"#e0ddd6",
  text:"#1a1a1a", muted:"#aaa", muted2:"#777",
  tabs:{ casa:"#2a9e6a", viajes:"#1a7fc1", personal:"#7c3aed", laboral:"#c97a1a" },
  estados:{ pendiente:"#dc4a4a", "en-proceso":"#c9a020", finalizada:"#2a9e6a" },
};

const uid = () => Math.random().toString(36).slice(2,8);
const ESTADOS = ["pendiente","en-proceso","finalizada"];
const ELABELS = { pendiente:"Pendiente", "en-proceso":"En proceso", finalizada:"Lista" };
const nextE = e => ESTADOS[(ESTADOS.indexOf(e)+1)%3];
const DIAS_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES_S = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const COLORES_DIA = ["#e85494","#1a7fc1","#2a9e6a","#7c3aed","#c97a1a","#dc4a4a","#e8a020"];

function reorder(arr, fromId, toId) {
  const from = arr.findIndex(x => x.id === fromId);
  const to = arr.findIndex(x => x.id === toId);
  if (from === -1 || to === -1 || from === to) return arr;
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

function getProximaFecha(diaSemana) {
  const hoy = new Date(); const hoyDia = hoy.getDay();
  let diff = diaSemana - hoyDia; if(diff<=0) diff+=7;
  const f = new Date(hoy); f.setDate(hoy.getDate()+diff);
  return f.toISOString().slice(0,10);
}
function parseFechaCustom(str) {
  const MESES = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,oct:9,nov:10,dic:11};
  const m = str.trim().match(/^(\d{2})-([a-záéíóú]{3})$/i);
  if(!m) return null;
  const dia=parseInt(m[1]), mes=MESES[m[2].toLowerCase()];
  if(mes===undefined||isNaN(dia)) return null;
  const hoy=new Date(); let anio=hoy.getFullYear();
  const c=new Date(anio,mes,dia); if(c<hoy) anio+=1;
  return new Date(anio,mes,dia).toISOString().slice(0,10);
}

const INICIAL_CASA = ["Podar árbol de la calle","Podar árbol del fondo","Desagote de los pozos","Arreglo de pérdida de pileta","Humedad cajón nórdico","Boca de llave baño principal","Trabas de seguridad ventanas","Acceso de roedores"].map((texto,i)=>({id:"c"+i,texto,estado:"pendiente",notas:""}));
const INICIAL_VIAJES = { destinos:[{id:"d0",nombre:"USA 2026"},{id:"d1",nombre:"Tandil 2026"}], tareas:[{id:"t0",destinoId:"d0",texto:"Sacar pasaportes",estado:"pendiente",notas:""},{id:"t1",destinoId:"d1",texto:"Reservar alojamiento",estado:"pendiente",notas:""}] };
const INICIAL_PERSONAL = [{id:"p0",texto:"Revisar metas 2025",estado:"pendiente",notas:""}];
const INICIAL_LABORAL = { notas:[], agenda:[] };

async function dbGet(key) {
  try {
    const { data, error } = await supabase.from("hub_data").select("value").eq("key", key).single();
    if (error || !data) return null;
    return JSON.parse(data.value);
  } catch { return null; }
}
async function dbSet(key, value) {
  try {
    await supabase.from("hub_data").upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
  } catch {}
}

function useStorage(key, inicial) {
  const [data, setData] = useState(inicial);
  const saving = useRef(false); const inited = useRef(false);
  const load = useCallback(async()=>{
    if(saving.current) return;
    const val = await dbGet(key);
    if(val !== null) {
      setData(Array.isArray(val) ? val.map(t=>({notas:"",...t})) : val);
    } else if(!inited.current) {
      inited.current = true;
      await dbSet(key, inicial);
    }
  },[key]);
  useEffect(()=>{ load(); const iv=setInterval(load,8000); return()=>clearInterval(iv); },[load]);
  const update = useCallback((fn)=>{
    setData(prev=>{
      const n = typeof fn==="function" ? fn(prev) : fn;
      saving.current = true;
      dbSet(key, n).then(()=>{ saving.current=false; });
      return n;
    });
  },[key]);
  return [data, update];
}

const inputSt = { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", fontFamily:"system-ui,sans-serif", fontSize:14, color:C.text, outline:"none" };
const btnSt = (bg,col,border)=>({ padding:"10px 0", borderRadius:10, fontFamily:"system-ui,sans-serif", fontSize:14, fontWeight:600, background:bg, color:col, border:`1px solid ${border||bg}`, cursor:"pointer" });

function Modal({onClose,isMobile,title,children}) {
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:200,display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center"}}>
      <div style={{background:C.surface,borderRadius:isMobile?"20px 20px 0 0":16,padding:"22px 20px 36px",width:"100%",maxWidth:isMobile?"100%":440,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        {title&&<div style={{fontWeight:700,fontSize:16,marginBottom:16,color:C.text}}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

function TareaCard({t, onCiclar, onEliminar, onNota, onEditar, accentColor, isMobile}) {
  const [editando, setEditando] = useState(false);
  const [editVal, setEditVal] = useState(t.texto);
  const tieneNota = t.notas?.trim().length > 0;
  const col = C.estados[t.estado];
  const fs = isMobile ? 16 : 14;
  const fsLabel = isMobile ? 12 : 10;

  function guardarEdicion() {
    const txt = editVal.trim();
    if(txt && txt !== t.texto) onEditar(t.id, txt);
    setEditando(false);
  }

  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:11,padding:"11px 14px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div onClick={()=>onCiclar(t.id)} style={{width:9,height:9,borderRadius:"50%",background:col,flexShrink:0,cursor:"pointer"}}/>
      <div style={{flex:1,minWidth:0}}>
        {editando ? (
          <input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")guardarEdicion(); if(e.key==="Escape")setEditando(false);}}
            onBlur={guardarEdicion}
            style={{...inputSt,padding:"4px 8px",fontSize:fs,width:"100%"}}/>
        ) : (
          <div onClick={()=>onCiclar(t.id)} style={{fontSize:fs,lineHeight:1.35,textDecoration:t.estado==="finalizada"?"line-through":"none",color:t.estado==="finalizada"?C.muted:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",textAlign:"left"}}>
            {t.texto}
          </div>
        )}
        {tieneNota&&!editando&&<div style={{fontSize:11,color:C.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📝 {t.notas.slice(0,55)}{t.notas.length>55?"…":""}</div>}
      </div>
      {!editando&&<span onClick={()=>onCiclar(t.id)} style={{fontSize:fsLabel,padding:"3px 8px",borderRadius:20,background:col+"15",color:col,fontWeight:600,flexShrink:0,border:`1px solid ${col}44`,cursor:"pointer"}}>{ELABELS[t.estado]}</span>}
      {!editando&&<button onClick={()=>setEditando(true)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:7,color:C.muted2,fontSize:11,padding:"4px 7px",cursor:"pointer",flexShrink:0}}>✏️</button>}
      {!editando&&<button onClick={e=>{e.stopPropagation();onNota(t);}} style={{background:tieneNota?accentColor+"15":"transparent",border:`1px solid ${tieneNota?accentColor+"55":C.border}`,borderRadius:7,color:tieneNota?accentColor:C.muted,fontSize:11,fontWeight:700,padding:"4px 7px",cursor:"pointer",flexShrink:0,position:"relative"}}>
        N{tieneNota&&<span style={{position:"absolute",top:-3,right:-3,width:6,height:6,borderRadius:"50%",background:"#c9a020",border:`1px solid ${C.bg}`}}/>}
      </button>}
      {!editando&&<button onClick={e=>{e.stopPropagation();if(window.confirm("¿Eliminar?"))onEliminar(t.id);}} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>}
    </div>
  );
}

function PanelTareas({storeKey, shared, inicial, color, isMobile}) {
  const [tareas,update]=useStorage(storeKey,inicial);
  const [filtros,setFiltros]=useState(new Set());
  const [busqueda,setBusqueda]=useState("");
  const [sortE,setSortE]=useState(null);
  const [modal,setModal]=useState(false);
  const [input,setInput]=useState("");
  const [notaTarea,setNotaTarea]=useState(null);
  const [notaVal,setNotaVal]=useState("");
  const dragId = useRef(null);
  const [dragOverId,setDragOverId]=useState(null);

  const ciclar=id=>update(p=>p.map(t=>t.id===id?{...t,estado:nextE(t.estado)}:t));
  const eliminar=id=>update(p=>p.filter(t=>t.id!==id));
  const editar=(id,texto)=>update(p=>p.map(t=>t.id===id?{...t,texto}:t));
  const agregar=()=>{ const txt=input.trim(); if(!txt)return; update(p=>[...p,{id:uid(),texto:txt,estado:"pendiente",notas:""}]); setInput(""); setModal(false); };
  const abrirNota=t=>{setNotaTarea(t);setNotaVal(t.notas||"");};
  const guardarNota=()=>{ update(p=>p.map(t=>t.id===notaTarea.id?{...t,notas:notaVal}:t)); setNotaTarea(null); };
  const toggleFiltro=f=>{setFiltros(p=>{const n=new Set(p);n.has(f)?n.delete(f):n.add(f);return n;});setSortE(null);};
  const toggleSort=e=>{setSortE(p=>p===e?null:e);setFiltros(new Set());};
  const copiarLink=()=>{try{navigator.clipboard.writeText(window.location.href);alert("Link copiado ✓");}catch{alert("No se pudo copiar");}};

  const activas=useMemo(()=>{
    let b=tareas.filter(t=>t.estado!=="finalizada");
    if(busqueda) b=b.filter(t=>t.texto.toLowerCase().includes(busqueda.toLowerCase())||t.notas?.toLowerCase().includes(busqueda.toLowerCase()));
    if(filtros.size) b=b.filter(t=>filtros.has(t.estado));
    if(sortE) b=[...b].sort((a,b)=>a.estado===sortE?-1:b.estado===sortE?1:0);
    return b;
  },[tareas,filtros,busqueda,sortE]);

  const listas=useMemo(()=>{ let b=tareas.filter(t=>t.estado==="finalizada"); if(busqueda) b=b.filter(t=>t.texto.toLowerCase().includes(busqueda.toLowerCase())||t.notas?.toLowerCase().includes(busqueda.toLowerCase())); return b; },[tareas,busqueda]);
  const cnt={pendiente:tareas.filter(t=>t.estado==="pendiente").length,"en-proceso":tareas.filter(t=>t.estado==="en-proceso").length,finalizada:tareas.filter(t=>t.estado==="finalizada").length};
  const ph=isMobile?"14px":"24px";
  const gridStyle = isMobile ? {display:"flex",flexDirection:"column",gap:7} : {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10};

  function DragCard({t}) {
    return (
      <div
        draggable
        onDragStart={()=>{ dragId.current=t.id; }}
        onDragOver={e=>{ e.preventDefault(); setDragOverId(t.id); }}
        onDrop={e=>{ e.preventDefault(); if(dragId.current&&dragId.current!==t.id){ update(p=>reorder(p,dragId.current,t.id)); } dragId.current=null; setDragOverId(null); }}
        onDragEnd={()=>{ dragId.current=null; setDragOverId(null); }}
        style={{opacity:dragOverId===t.id&&dragId.current!==t.id?0.5:1,cursor:"grab"}}
      >
        <TareaCard t={t} onCiclar={ciclar} onEliminar={eliminar} onNota={abrirNota} onEditar={editar} accentColor={color} isMobile={isMobile}/>
      </div>
    );
  }

  return (
    <div style={{paddingBottom:80}}>
      <div style={{padding:`10px ${ph}`,borderBottom:`1px solid ${C.border}`,position:"sticky",top:49,background:C.bg,zIndex:8,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {Object.entries(cnt).map(([e,n])=>(<span key={e} style={{fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:20,border:`1px solid ${C.estados[e]}44`,background:C.estados[e]+"12",color:C.estados[e]}}>{ELABELS[e]} {n}</span>))}
          {shared&&<button onClick={copiarLink} style={{marginLeft:"auto",fontSize:11,padding:"4px 10px",borderRadius:20,background:"transparent",border:`1px solid ${C.border}`,color:C.muted2,cursor:"pointer",fontFamily:"system-ui,sans-serif"}}>🔗 Copiar link</button>}
        </div>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="🔍 Buscar..." style={{...inputSt,padding:"8px 11px",fontSize:13,background:C.surface2}}/>
        <div style={{display:"flex",gap:5,overflowX:"auto"}}>
          {["pendiente","en-proceso"].map(f=>(<button key={f} onClick={()=>toggleFiltro(f)} style={{fontFamily:"system-ui,sans-serif",fontSize:11,padding:"5px 11px",borderRadius:20,flexShrink:0,cursor:"pointer",border:`1px solid ${filtros.has(f)?C.estados[f]:C.border}`,background:filtros.has(f)?C.estados[f]+"15":"transparent",color:filtros.has(f)?C.estados[f]:C.muted,fontWeight:filtros.has(f)?600:400}}>✓ {ELABELS[f]}</button>))}
          {["pendiente","en-proceso"].map(f=>(<button key={"s"+f} onClick={()=>toggleSort(f)} style={{fontFamily:"system-ui,sans-serif",fontSize:11,padding:"5px 11px",borderRadius:20,flexShrink:0,cursor:"pointer",border:`1px solid ${sortE===f?C.estados[f]:C.border}`,background:sortE===f?C.estados[f]:"transparent",color:sortE===f?"#fff":C.muted,fontWeight:sortE===f?700:400}}>↑ {ELABELS[f]}</button>))}
          {(filtros.size>0||sortE)&&<button onClick={()=>{setFiltros(new Set());setSortE(null);}} style={{fontFamily:"system-ui,sans-serif",fontSize:11,padding:"5px 10px",borderRadius:20,flexShrink:0,cursor:"pointer",border:`1px solid ${C.border}`,background:"transparent",color:C.muted}}>✕</button>}
        </div>
      </div>

      <div style={{padding:`10px ${ph}`}}>
        {activas.length===0&&listas.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted,fontSize:14}}>Sin tareas. Usá + para agregar.</div>}
        <div style={gridStyle}>
          {activas.map(t=><DragCard key={t.id} t={t}/>)}
        </div>
      </div>

      {listas.length>0&&(
        <div style={{padding:`0 ${ph} 16px`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,margin:"8px 0 10px"}}><div style={{flex:1,height:1,background:C.border}}/><span style={{fontSize:11,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>✅ LISTAS ({listas.length})</span><div style={{flex:1,height:1,background:C.border}}/></div>
          <div style={{...gridStyle,opacity:0.5}}>{listas.map(t=><DragCard key={t.id} t={t}/>)}</div>
        </div>
      )}

      <button onClick={()=>setModal(true)} style={{position:"fixed",bottom:24,right:isMobile?16:28,width:52,height:52,borderRadius:"50%",background:color,color:"#fff",border:"none",fontSize:26,cursor:"pointer",zIndex:50,boxShadow:`0 4px 16px ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>+</button>

      {modal&&<Modal onClose={()=>{setModal(false);setInput("");}} isMobile={isMobile} title="Nueva tarea">
        <input autoFocus value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregar()} placeholder="Descripción..." style={inputSt}/>
        <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>{setModal(false);setInput("");}} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={agregar} style={{...btnSt(color,"#fff"),flex:1}}>Agregar</button></div>
      </Modal>}

      {notaTarea&&<Modal onClose={()=>setNotaTarea(null)} isMobile={isMobile} title="">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,marginTop:-8}}><div style={{width:8,height:8,borderRadius:"50%",background:C.estados[notaTarea.estado],flexShrink:0}}/><div style={{fontSize:13,color:C.muted2}}>{notaTarea.texto}</div></div>
        <textarea value={notaVal} onChange={e=>setNotaVal(e.target.value)} rows={5} placeholder="Materiales, presupuesto, contacto..." style={{...inputSt,resize:"none",lineHeight:1.6}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setNotaTarea(null)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={guardarNota} style={{...btnSt(color,"#fff"),flex:1}}>Guardar</button></div>
      </Modal>}
    </div>
  );
}

function PanelViajes({isMobile}) {
  const color=C.tabs.viajes;
  const [data,update]=useStorage(KEYS.viajes,INICIAL_VIAJES);
  const destinos=data?.destinos||[];
  const tareas=data?.tareas||[];
  const [modalDest,setModalDest]=useState(false);
  const [modalTarea,setModalTarea]=useState(null);
  const [notaTarea,setNotaTarea]=useState(null);
  const [notaVal,setNotaVal]=useState("");
  const [inputDest,setInputDest]=useState("");
  const [inputTarea,setInputTarea]=useState("");
  const [busqueda,setBusqueda]=useState("");
  const [collapsed,setCollapsed]=useState(new Set());
  const dragId = useRef(null);
  const [dragOverId,setDragOverId]=useState(null);
  const ph=isMobile?"14px":"24px";
  const gridStyle = isMobile ? {display:"flex",flexDirection:"column",gap:7} : {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10};

  const setD=fn=>update(p=>({...p,destinos:typeof fn==="function"?fn(p.destinos||[]):fn}));
  const setT=fn=>update(p=>({...p,tareas:typeof fn==="function"?fn(p.tareas||[]):fn}));

  const agregarDest=()=>{ const n=inputDest.trim(); if(!n)return; setD(p=>[...p,{id:uid(),nombre:n}]); setInputDest(""); setModalDest(false); };
  const eliminarDest=id=>{ if(!window.confirm("¿Eliminar destino y todas sus tareas?"))return; update(p=>({destinos:(p.destinos||[]).filter(d=>d.id!==id),tareas:(p.tareas||[]).filter(t=>t.destinoId!==id)})); };
  const agregarTarea=()=>{ const txt=inputTarea.trim(); if(!txt)return; setT(p=>[...p,{id:uid(),destinoId:modalTarea,texto:txt,estado:"pendiente",notas:""}]); setInputTarea(""); setModalTarea(null); };
  const ciclar=id=>setT(p=>p.map(t=>t.id===id?{...t,estado:nextE(t.estado)}:t));
  const eliminarT=id=>setT(p=>p.filter(t=>t.id!==id));
  const editar=(id,texto)=>setT(p=>p.map(t=>t.id===id?{...t,texto}:t));
  const abrirNota=t=>{setNotaTarea(t);setNotaVal(t.notas||"");};
  const guardarNota=()=>{ setT(p=>p.map(t=>t.id===notaTarea.id?{...t,notas:notaVal}:t)); setNotaTarea(null); };
  const toggleCollapse=id=>setCollapsed(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const copiarLink=()=>{try{navigator.clipboard.writeText(window.location.href);alert("Link copiado ✓");}catch{alert("No se pudo copiar");}};

  return (
    <div style={{paddingBottom:80}}>
      <div style={{padding:`10px ${ph}`,borderBottom:`1px solid ${C.border}`,position:"sticky",top:49,background:C.bg,zIndex:8,display:"flex",gap:8,alignItems:"center"}}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="🔍 Buscar..." style={{...inputSt,padding:"8px 11px",fontSize:13,background:C.surface2,flex:1}}/>
        <button onClick={copiarLink} style={{fontSize:11,padding:"8px 10px",borderRadius:20,background:"transparent",border:`1px solid ${C.border}`,color:C.muted2,cursor:"pointer",fontFamily:"system-ui,sans-serif",whiteSpace:"nowrap"}}>🔗 Link</button>
      </div>
      <div style={{padding:`12px ${ph}`,display:"flex",flexDirection:"column",gap:16}}>
        {destinos.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted,fontSize:14}}>Sin destinos. Usá + para agregar.</div>}
        {destinos.map(dest=>{
          const tareasD=tareas.filter(t=>t.destinoId===dest.id&&(busqueda?t.texto.toLowerCase().includes(busqueda.toLowerCase())||t.notas?.toLowerCase().includes(busqueda.toLowerCase()):true));
          const activas=tareasD.filter(t=>t.estado!=="finalizada");
          const listas=tareasD.filter(t=>t.estado==="finalizada");
          const isCollapsed=collapsed.has(dest.id);
          const cnt={p:tareasD.filter(t=>t.estado==="pendiente").length,e:tareasD.filter(t=>t.estado==="en-proceso").length,f:tareasD.filter(t=>t.estado==="finalizada").length};
          return (
            <div key={dest.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"13px 14px",cursor:"pointer",borderBottom:isCollapsed?"none":`1px solid ${C.border}`}} onClick={()=>toggleCollapse(dest.id)}>
                <span style={{fontSize:16}}>✈️</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:15,color:C.text}}>{dest.nombre}</div>
                  <div style={{display:"flex",gap:5,marginTop:3}}>
                    {cnt.p>0&&<span style={{fontSize:10,color:C.estados.pendiente,fontWeight:600}}>{cnt.p} pend.</span>}
                    {cnt.e>0&&<span style={{fontSize:10,color:C.estados["en-proceso"],fontWeight:600}}>{cnt.e} en curso</span>}
                    {cnt.f>0&&<span style={{fontSize:10,color:C.estados.finalizada,fontWeight:600}}>{cnt.f} lista</span>}
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();setModalTarea(dest.id);setInputTarea("");}} style={{fontSize:18,background:color+"15",border:`1px solid ${color}44`,borderRadius:8,color:color,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>+</button>
                <button onClick={e=>{e.stopPropagation();eliminarDest(dest.id);}} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
                <span style={{color:C.muted,fontSize:12}}>{isCollapsed?"▶":"▼"}</span>
              </div>
              {!isCollapsed&&(
                <div style={{padding:"10px 12px"}}>
                  {activas.length===0&&listas.length===0&&<div style={{fontSize:13,color:C.muted,textAlign:"center",padding:"10px 0"}}>Sin tareas para este destino</div>}
                  <div style={gridStyle}>
                    {activas.map(t=>(
                      <div key={t.id} draggable
                        onDragStart={()=>{ dragId.current=t.id; }}
                        onDragOver={e=>{ e.preventDefault(); setDragOverId(t.id); }}
                        onDrop={e=>{ e.preventDefault(); if(dragId.current&&dragId.current!==t.id){ setT(p=>reorder(p,dragId.current,t.id)); } dragId.current=null; setDragOverId(null); }}
                        onDragEnd={()=>{ dragId.current=null; setDragOverId(null); }}
                        style={{opacity:dragOverId===t.id&&dragId.current!==t.id?0.5:1,cursor:"grab"}}>
                        <TareaCard t={t} onCiclar={ciclar} onEliminar={eliminarT} onNota={abrirNota} onEditar={editar} accentColor={color} isMobile={isMobile}/>
                      </div>
                    ))}
                  </div>
                  {listas.length>0&&(
                    <>
                      <div style={{display:"flex",alignItems:"center",gap:8,margin:"8px 0"}}><div style={{flex:1,height:1,background:C.border}}/><span style={{fontSize:10,color:C.muted,fontWeight:600}}>LISTAS ({listas.length})</span><div style={{flex:1,height:1,background:C.border}}/></div>
                      <div style={{...gridStyle,opacity:0.5}}>
                        {listas.map(t=>(
                          <div key={t.id} draggable
                            onDragStart={()=>{ dragId.current=t.id; }}
                            onDragOver={e=>{ e.preventDefault(); setDragOverId(t.id); }}
                            onDrop={e=>{ e.preventDefault(); if(dragId.current&&dragId.current!==t.id){ setT(p=>reorder(p,dragId.current,t.id)); } dragId.current=null; setDragOverId(null); }}
                            onDragEnd={()=>{ dragId.current=null; setDragOverId(null); }}
                            style={{opacity:dragOverId===t.id&&dragId.current!==t.id?0.5:1,cursor:"grab"}}>
                            <TareaCard t={t} onCiclar={ciclar} onEliminar={eliminarT} onNota={abrirNota} onEditar={editar} accentColor={color} isMobile={isMobile}/>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={()=>setModalDest(true)} style={{position:"fixed",bottom:24,right:isMobile?16:28,width:52,height:52,borderRadius:"50%",background:color,color:"#fff",border:"none",fontSize:26,cursor:"pointer",zIndex:50,boxShadow:`0 4px 16px ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>+</button>
      {modalDest&&<Modal onClose={()=>setModalDest(false)} isMobile={isMobile} title="Nuevo destino"><input autoFocus value={inputDest} onChange={e=>setInputDest(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregarDest()} placeholder="ej: USA 2026" style={inputSt}/><div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setModalDest(false)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={agregarDest} style={{...btnSt(color,"#fff"),flex:1}}>Agregar</button></div></Modal>}
      {modalTarea&&<Modal onClose={()=>setModalTarea(null)} isMobile={isMobile} title="Nueva tarea"><input autoFocus value={inputTarea} onChange={e=>setInputTarea(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregarTarea()} placeholder="Descripción..." style={inputSt}/><div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setModalTarea(null)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={agregarTarea} style={{...btnSt(color,"#fff"),flex:1}}>Agregar</button></div></Modal>}
      {notaTarea&&<Modal onClose={()=>setNotaTarea(null)} isMobile={isMobile} title=""><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,marginTop:-8}}><div style={{width:8,height:8,borderRadius:"50%",background:C.estados[notaTarea.estado],flexShrink:0}}/><div style={{fontSize:13,color:C.muted2}}>{notaTarea.texto}</div></div><textarea value={notaVal} onChange={e=>setNotaVal(e.target.value)} rows={5} placeholder="Detalles, links, presupuesto..." style={{...inputSt,resize:"none",lineHeight:1.6}}/><div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setNotaTarea(null)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={guardarNota} style={{...btnSt(color,"#fff"),flex:1}}>Guardar</button></div></Modal>}
    </div>
  );
}

function PanelLaboral({isMobile}) {
  const color=C.tabs.laboral;
  const [laboral,setLaboral]=useStorage(KEYS.laboral,INICIAL_LABORAL);
  const notas=laboral?.notas||[];
  const agenda=laboral?.agenda||[];
  const [busqueda,setBusqueda]=useState("");
  const [modalNota,setModalNota]=useState(false);
  const [editNota,setEditNota]=useState(null);
  const [notaVal,setNotaVal]=useState("");
  const [modalEvento,setModalEvento]=useState(false);
  const [modoFecha,setModoFecha]=useState("dia");
  const [diaSel,setDiaSel]=useState("1");
  const [fechaCustom,setFechaCustom]=useState("");
  const [horaEvento,setHoraEvento]=useState("");
  const [textoEvento,setTextoEvento]=useState("");
  const [editandoEvento,setEditandoEvento]=useState(null);
  const [editEventoVal,setEditEventoVal]=useState("");
  const [editEventoHora,setEditEventoHora]=useState("");
  const [notaEventoModal,setNotaEventoModal]=useState(null);
  const [notaEventoVal,setNotaEventoVal]=useState("");
  const [notaDetalleModal,setNotaDetalleModal]=useState(null);
  const [notaDetalleVal,setNotaDetalleVal]=useState("");
  const dragIdA = useRef(null);
  const [dragOverIdA,setDragOverIdA]=useState(null);
  const dragIdN = useRef(null);
  const [dragOverIdN,setDragOverIdN]=useState(null);
  const ph=isMobile?"14px":"24px";
  const gridNotas = isMobile ? {display:"flex",flexDirection:"column",gap:6} : {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10};

  const setN=fn=>setLaboral(p=>({...p,notas:typeof fn==="function"?fn(p.notas||[]):fn}));
  const setA=fn=>setLaboral(p=>({...p,agenda:typeof fn==="function"?fn(p.agenda||[]):fn}));

  const agregarNota=()=>{ const t=notaVal.trim(); if(!t)return; setN(p=>[{id:uid(),texto:t,hecho:false,detalle:""},...p]); setNotaVal(""); setModalNota(false); };
  const editarNotaFn=()=>{ setN(p=>p.map(n=>n.id===editNota.id?{...n,texto:notaVal}:n)); setEditNota(null); setNotaVal(""); };
  const toggleNota=id=>setN(p=>p.map(n=>n.id===id?{...n,hecho:!n.hecho}:n));
  const eliminarNota=id=>setN(p=>p.filter(n=>n.id!==id));
  const guardarDetalle=()=>{ setN(p=>p.map(n=>n.id===notaDetalleModal.id?{...n,detalle:notaDetalleVal}:n)); setNotaDetalleModal(null); };

  const agregarEvento=()=>{
    const txt=textoEvento.trim(); if(!txt)return;
    let isoDate=null;
    if(modoFecha==="dia") isoDate=getProximaFecha(parseInt(diaSel));
    else { isoDate=parseFechaCustom(fechaCustom); if(!isoDate){alert("Formato inválido. Usá DD-mes, ej: 09-may");return;} }
    setA(p=>[...p,{id:uid(),texto:txt,isoDate,hora:horaEvento,hecho:false,notas:""}].sort((a,b)=>(!a.isoDate&&!b.isoDate?0:!a.isoDate?1:!b.isoDate?-1:a.isoDate.localeCompare(b.isoDate)||(a.hora||"").localeCompare(b.hora||""))));
    setTextoEvento(""); setHoraEvento(""); setFechaCustom(""); setDiaSel("1"); setModalEvento(false);
  };
  const toggleEvento=id=>setA(p=>p.map(e=>e.id===id?{...e,hecho:!e.hecho}:e));
  const eliminarEvento=id=>setA(p=>p.filter(e=>e.id!==id));
  const editarEvento=(id,texto,hora)=>setA(p=>p.map(e=>e.id===id?{...e,texto,hora}:e));
  const guardarNotaEvento=()=>{ setA(p=>p.map(e=>e.id===notaEventoModal.id?{...e,notas:notaEventoVal}:e)); setNotaEventoModal(null); };

  const hoyISO=new Date().toISOString().slice(0,10);
  const hoyDate=new Date(); hoyDate.setHours(0,0,0,0);
  const bq=busqueda.toLowerCase();

  const agendaActiva=useMemo(()=>{
    const grupos={};
    agenda.filter(e=>!e.hecho&&e.isoDate>=hoyISO).filter(e=>!bq||e.texto.toLowerCase().includes(bq)).forEach(e=>{
      if(!grupos[e.isoDate]) grupos[e.isoDate]=[];
      grupos[e.isoDate].push(e);
    });
    return grupos;
  },[agenda,bq,hoyISO]);

  const diasAgenda=Object.keys(agendaActiva).sort();
  const notasActivas=useMemo(()=>notas.filter(n=>!n.hecho&&(!bq||n.texto.toLowerCase().includes(bq))),[notas,bq]);
  const hechos=useMemo(()=>[
    ...notas.filter(n=>n.hecho&&(!bq||n.texto.toLowerCase().includes(bq))).map(n=>({...n,tipo:"nota"})),
    ...agenda.filter(e=>e.hecho&&(!bq||e.texto.toLowerCase().includes(bq))).map(e=>({...e,tipo:"evento"})),
  ],[notas,agenda,bq]);

  const agendaGrid = isMobile
    ? {display:"flex",flexDirection:"column",gap:16}
    : {display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"};

  return (
    <div style={{paddingBottom:80}}>
      <div style={{padding:`10px ${ph}`,borderBottom:`1px solid ${C.border}`,position:"sticky",top:49,background:C.bg,zIndex:8}}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="🔍 Buscar en agenda y notas..." style={{...inputSt,padding:"8px 11px",fontSize:13,background:C.surface2}}/>
      </div>

      <div style={{padding:`14px ${ph}`,display:"flex",flexDirection:"column",gap:20}}>

        {/* AGENDA */}
        <section>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:color,letterSpacing:0.5,textTransform:"uppercase"}}>📅 Agenda</div>
            <button onClick={()=>setModalEvento(true)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:color+"15",border:`1px solid ${color}44`,color:color,cursor:"pointer",fontFamily:"system-ui,sans-serif",fontWeight:600}}>+ Evento</button>
          </div>
          {diasAgenda.length===0&&<div style={{fontSize:13,color:C.muted,padding:"8px 0"}}>Sin eventos próximos</div>}
          <div style={agendaGrid}>
            {diasAgenda.map(isoDate=>{
              const [y,m,d]=isoDate.split("-").map(Number);
              const fecha=new Date(y,m-1,d); fecha.setHours(0,0,0,0);
              const diff=Math.round((fecha-hoyDate)/86400000);
              const nombreDia = DIAS_ES[fecha.getDay()].toUpperCase();
              const esHoy = diff === 0;
              const esMañana = diff === 1;
              const colorDia = COLORES_DIA[fecha.getDay()];
              return (
                <div key={isoDate} style={{background:C.surface,border:`1px solid ${colorDia}44`,borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
                  <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${colorDia}33`,background:colorDia+"12",display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:14,height:14,borderRadius:3,background:colorDia,flexShrink:0}}/>
                    <div>
                      <div style={{fontWeight:800,fontSize:16,color:colorDia,letterSpacing:0.3}}>{nombreDia}</div>
                      {(esHoy||esMañana)&&<div style={{fontSize:10,color:colorDia,fontWeight:600,textTransform:"uppercase",opacity:0.8}}>{esHoy?"Hoy":"Mañana"} · {String(d).padStart(2,"0")} {MESES_S[m-1]}</div>}
                      {!esHoy&&!esMañana&&<div style={{fontSize:10,color:C.muted}}>{String(d).padStart(2,"0")} {MESES_S[m-1]}</div>}
                    </div>
                  </div>
                  <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
                    {agendaActiva[isoDate].map(e=>{
                      const tieneNotaE = e.notas?.trim().length > 0;
                      const editando = editandoEvento===e.id;
                      return (
                        <div key={e.id}
                          draggable={!editando}
                          onDragStart={()=>{ dragIdA.current=e.id; }}
                          onDragOver={ev=>{ ev.preventDefault(); setDragOverIdA(e.id); }}
                          onDrop={ev=>{ ev.preventDefault(); if(dragIdA.current&&dragIdA.current!==e.id){ setA(p=>reorder(p,dragIdA.current,e.id)); } dragIdA.current=null; setDragOverIdA(null); }}
                          onDragEnd={()=>{ dragIdA.current=null; setDragOverIdA(null); }}
                          style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.border}99`,opacity:dragOverIdA===e.id&&dragIdA.current!==e.id?0.5:1,cursor:editando?"default":"grab"}}>
                          <button onClick={()=>toggleEvento(e.id)} style={{width:16,height:16,borderRadius:4,border:`2px solid ${colorDia}`,background:"transparent",cursor:"pointer",flexShrink:0,padding:0}}/>
                          {editando ? (
                            <>
                              <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
                                <input autoFocus value={editEventoVal} onChange={ev=>setEditEventoVal(ev.target.value)}
                                  onKeyDown={ev=>{ if(ev.key==="Escape") setEditandoEvento(null); }}
                                  style={{...inputSt,padding:"3px 7px",fontSize:14}}/>
                                <input type="time" value={editEventoHora} onChange={ev=>setEditEventoHora(ev.target.value)}
                                  style={{...inputSt,padding:"3px 7px",fontSize:14}}/>
                              </div>
                              <button onClick={()=>{ editarEvento(e.id,editEventoVal.trim()||e.texto,editEventoHora); setEditandoEvento(null); }} style={{background:colorDia,border:"none",borderRadius:6,color:"#fff",fontSize:13,padding:"5px 10px",cursor:"pointer",flexShrink:0,fontWeight:700}}>✓</button>
                              <button onClick={()=>setEditandoEvento(null)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,fontSize:13,padding:"5px 8px",cursor:"pointer",flexShrink:0}}>✕</button>
                            </>
                          ) : (
                            <>
                              {e.hora&&<span style={{fontSize:13,fontWeight:700,color:colorDia,flexShrink:0,minWidth:38}}>{e.hora}</span>}
                              <span style={{flex:1,fontSize:isMobile?16:14,color:C.text,textAlign:"left"}}>{e.texto}</span>
                              <button onClick={()=>{ setEditandoEvento(e.id); setEditEventoVal(e.texto); setEditEventoHora(e.hora||""); }} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted2,fontSize:11,padding:"3px 6px",cursor:"pointer",flexShrink:0}}>✏️</button>
                              <button onClick={()=>{ setNotaEventoModal(e); setNotaEventoVal(e.notas||""); }} style={{background:tieneNotaE?colorDia+"15":"transparent",border:`1px solid ${tieneNotaE?colorDia+"55":C.border}`,borderRadius:6,color:tieneNotaE?colorDia:C.muted,fontSize:11,fontWeight:700,padding:"3px 6px",cursor:"pointer",flexShrink:0,position:"relative"}}>
                                N{tieneNotaE&&<span style={{position:"absolute",top:-3,right:-3,width:6,height:6,borderRadius:"50%",background:"#c9a020",border:`1px solid ${C.bg}`}}/>}
                              </button>
                              <button onClick={()=>eliminarEvento(e.id)} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div style={{height:1,background:C.border}}/>

        {/* NOTAS */}
        <section>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:color,letterSpacing:0.5,textTransform:"uppercase"}}>📝 Notas</div>
            <button onClick={()=>{setModalNota(true);setNotaVal("");}} style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:color+"15",border:`1px solid ${color}44`,color:color,cursor:"pointer",fontFamily:"system-ui,sans-serif",fontWeight:600}}>+ Nota</button>
          </div>
          {notasActivas.length===0&&<div style={{fontSize:13,color:C.muted,padding:"8px 0"}}>Sin notas pendientes</div>}
          <div style={gridNotas}>
            {notasActivas.map(n=>{
              const tieneDetalle = n.detalle?.trim().length > 0;
              return (
                <div key={n.id}
                  draggable
                  onDragStart={()=>{ dragIdN.current=n.id; }}
                  onDragOver={e=>{ e.preventDefault(); setDragOverIdN(n.id); }}
                  onDrop={e=>{ e.preventDefault(); if(dragIdN.current&&dragIdN.current!==n.id){ setN(p=>reorder(p,dragIdN.current,n.id)); } dragIdN.current=null; setDragOverIdN(null); }}
                  onDragEnd={()=>{ dragIdN.current=null; setDragOverIdN(null); }}
                  style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",display:"flex",gap:10,alignItems:"flex-start",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",opacity:dragOverIdN===n.id&&dragIdN.current!==n.id?0.5:1,cursor:"grab"}}>
                  <button onClick={()=>toggleNota(n.id)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${color}`,background:"transparent",cursor:"pointer",flexShrink:0,marginTop:2,padding:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <span style={{fontSize:isMobile?16:14,lineHeight:1.55,color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word",textAlign:"left"}}>· {n.texto}</span>
                    {tieneDetalle&&<div style={{fontSize:11,color:C.muted,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📝 {n.detalle.slice(0,60)}{n.detalle.length>60?"…":""}</div>}
                  </div>
                  <div style={{display:"flex",gap:5,flexShrink:0}}>
                    <button onClick={()=>{ setNotaDetalleModal(n); setNotaDetalleVal(n.detalle||""); }} style={{background:tieneDetalle?color+"15":"transparent",border:`1px solid ${tieneDetalle?color+"55":C.border}`,borderRadius:6,color:tieneDetalle?color:C.muted,fontSize:11,fontWeight:700,padding:"3px 6px",cursor:"pointer",position:"relative"}}>
                      N{tieneDetalle&&<span style={{position:"absolute",top:-3,right:-3,width:6,height:6,borderRadius:"50%",background:"#c9a020",border:`1px solid ${C.bg}`}}/>}
                    </button>
                    <button onClick={()=>{setEditNota(n);setNotaVal(n.texto);}} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted2,fontSize:11,padding:"3px 7px",cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>eliminarNota(n.id)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* COMPLETADOS */}
        {hechos.length>0&&(
          <>
            <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:1,background:C.border}}/><span style={{fontSize:11,color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>✅ COMPLETADOS ({hechos.length})</span><div style={{flex:1,height:1,background:C.border}}/></div>
            <div style={{display:"flex",flexDirection:"column",gap:6,opacity:0.5}}>
              {hechos.map(item=>(
                <div key={item.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:11,color:C.muted,flexShrink:0}}>{item.tipo==="evento"?"📅":"📝"}</span>
                  {item.tipo==="evento"&&item.hora&&<span style={{fontSize:12,color:C.muted,flexShrink:0}}>{item.hora}</span>}
                  <span style={{flex:1,fontSize:13,color:C.muted,textDecoration:"line-through",whiteSpace:"pre-wrap",wordBreak:"break-word",textAlign:"left"}}>{item.texto}</span>
                  <button onClick={()=>item.tipo==="nota"?toggleNota(item.id):toggleEvento(item.id)} style={{fontSize:11,background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,padding:"2px 6px",cursor:"pointer"}}>↩</button>
                  <button onClick={()=>item.tipo==="nota"?eliminarNota(item.id):eliminarEvento(item.id)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <button onClick={()=>setModalEvento(true)} style={{position:"fixed",bottom:24,right:isMobile?16:28,width:52,height:52,borderRadius:"50%",background:color,color:"#fff",border:"none",fontSize:26,cursor:"pointer",zIndex:50,boxShadow:`0 4px 16px ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>+</button>

      {(modalNota||editNota)&&<Modal onClose={()=>{setModalNota(false);setEditNota(null);setNotaVal("");}} isMobile={isMobile} title={editNota?"Editar nota":"Nueva nota"}>
        <textarea autoFocus value={notaVal} onChange={e=>setNotaVal(e.target.value)} rows={4} placeholder="· Grindelia: adelantarle propuesta..." style={{...inputSt,resize:"none",lineHeight:1.6}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>{setModalNota(false);setEditNota(null);setNotaVal("");}} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={editNota?editarNotaFn:agregarNota} style={{...btnSt(color,"#fff"),flex:1}}>Guardar</button></div>
      </Modal>}

      {notaDetalleModal&&<Modal onClose={()=>setNotaDetalleModal(null)} isMobile={isMobile} title="">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,marginTop:-8}}><div style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/><div style={{fontSize:13,color:C.muted2}}>{notaDetalleModal.texto}</div></div>
        <textarea autoFocus value={notaDetalleVal} onChange={e=>setNotaDetalleVal(e.target.value)} rows={5} placeholder="Detalle, contexto, links..." style={{...inputSt,resize:"none",lineHeight:1.6}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setNotaDetalleModal(null)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={guardarDetalle} style={{...btnSt(color,"#fff"),flex:1}}>Guardar</button></div>
      </Modal>}

      {notaEventoModal&&<Modal onClose={()=>setNotaEventoModal(null)} isMobile={isMobile} title="">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,marginTop:-8}}><div style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/><div style={{fontSize:13,color:C.muted2}}>{notaEventoModal.texto}</div></div>
        <textarea autoFocus value={notaEventoVal} onChange={e=>setNotaEventoVal(e.target.value)} rows={5} placeholder="Detalles, links, ubicación..." style={{...inputSt,resize:"none",lineHeight:1.6}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>setNotaEventoModal(null)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={guardarNotaEvento} style={{...btnSt(color,"#fff"),flex:1}}>Guardar</button></div>
      </Modal>}

      {modalEvento&&(
        <Modal onClose={()=>setModalEvento(false)} isMobile={isMobile} title="Nuevo evento">
          <input value={textoEvento} onChange={e=>setTextoEvento(e.target.value)} placeholder="Descripción del evento..." style={{...inputSt,marginBottom:12}}/>
          <div style={{display:"flex",gap:0,marginBottom:12,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
            {[["dia","📅 Día de semana"],["fecha","🗓 Fecha específica"]].map(([k,label])=>(
              <button key={k} onClick={()=>setModoFecha(k)} style={{flex:1,padding:"9px 4px",fontFamily:"system-ui,sans-serif",fontSize:12,fontWeight:modoFecha===k?700:400,background:modoFecha===k?color:"transparent",color:modoFecha===k?"#fff":C.muted2,border:"none",cursor:"pointer"}}>{label}</button>
            ))}
          </div>
          {modoFecha==="dia"&&<select value={diaSel} onChange={e=>setDiaSel(e.target.value)} style={{...inputSt,marginBottom:10,cursor:"pointer"}}>{[1,2,3,4,5,6,0].map(d=><option key={d} value={d}>{DIAS_ES[d]}</option>)}</select>}
          {modoFecha==="fecha"&&<input value={fechaCustom} onChange={e=>setFechaCustom(e.target.value)} placeholder="ej: 09-may" style={{...inputSt,marginBottom:10}}/>}
          <input type="time" value={horaEvento} onChange={e=>setHoraEvento(e.target.value)} style={{...inputSt,marginBottom:12}}/>
          <div style={{display:"flex",gap:8}}><button onClick={()=>setModalEvento(false)} style={{...btnSt(C.surface2,C.muted2,C.border),flex:1}}>Cancelar</button><button onClick={agregarEvento} style={{...btnSt(color,"#fff"),flex:1}}>Agregar</button></div>
        </Modal>
      )}
    </div>
  );
}

const TABS=[{id:"laboral",label:"💼 Laboral",color:C.tabs.laboral},{id:"personal",label:"👤 Personal",color:C.tabs.personal},{id:"casa",label:"🏠 Casa",color:C.tabs.casa},{id:"viajes",label:"✈️ Viajes",color:C.tabs.viajes}];

export default function App() {
  const [tab,setTab]=useState("laboral");
  const isMobile=window.innerWidth<680;

  useEffect(() => {
    if (!("Notification" in window)) return;

    async function pedirPermiso() {
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result === "granted") programarNotificacion();
      } else if (Notification.permission === "granted") {
        programarNotificacion();
      }
    }

    function programarNotificacion() {
      const now = new Date();
      const target = new Date();
      target.setHours(7, 45, 0, 0);
      if (now >= target) target.setDate(target.getDate() + 1);
      const ms = target - now;
      setTimeout(() => {
        new Notification("📋 Buenos días", {
          body: "Revisá tu agenda y notas del día.",
          icon: "/vite.svg"
        });
        programarNotificacion();
      }, ms);
    }

    window.__activarNotificaciones = pedirPermiso;
    pedirPermiso();
  }, []);

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"system-ui,sans-serif"}}>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.bg,zIndex:10,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,minWidth:isMobile?68:90,padding:isMobile?"12px 4px":"13px 8px",fontFamily:"system-ui,sans-serif",fontSize:isMobile?11:13,fontWeight:tab===t.id?700:400,background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?t.color:"transparent"}`,color:tab===t.id?t.color:C.muted,cursor:"pointer",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>
      {("Notification" in window) && Notification.permission !== "granted" && (
        <button onClick={()=>window.__activarNotificaciones?.()} style={{
          position:"fixed", top:60, right:16, zIndex:999,
          background:"#c97a1a", color:"#fff", border:"none",
          borderRadius:20, padding:"6px 12px", fontSize:11,
          fontWeight:600, cursor:"pointer", fontFamily:"system-ui,sans-serif",
          boxShadow:"0 2px 8px rgba(0,0,0,0.2)"
        }}>🔔 Activar notificaciones</button>
      )}
      {tab==="casa"&&<PanelTareas storeKey={KEYS.casa} shared={true} inicial={INICIAL_CASA} color={C.tabs.casa} isMobile={isMobile}/>}
      {tab==="viajes"&&<PanelViajes isMobile={isMobile}/>}
      {tab==="personal"&&<PanelTareas storeKey={KEYS.personal} shared={false} inicial={INICIAL_PERSONAL} color={C.tabs.personal} isMobile={isMobile}/>}
      {tab==="laboral"&&<PanelLaboral isMobile={isMobile}/>}
    </div>
  );
}
