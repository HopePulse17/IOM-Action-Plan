export function $(sel, root=document){ return root.querySelector(sel); }
export function $$(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

export function fmtDate(iso){
  if(!iso) return "—";
  try{
    const d = new Date(iso);
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${day}/${m}/${y}`;
  }catch(e){ return iso; }
}

export function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.add("hidden"), 3200);
}

export function genWeeks(){
  const start = new Date("2026-01-21T00:00:00");
  const end = new Date("2026-09-20T00:00:00");
  const weeks = [];
  let i=1;
  let cur = new Date(start);
  while(cur <= end){
    const wStart = new Date(cur);
    const wEnd = new Date(cur);
    wEnd.setDate(wEnd.getDate()+6);
    if(wEnd > end) wEnd.setTime(end.getTime());
    const id = `W${String(i).padStart(2,'0')}`;
    weeks.push({
      id,
      start: wStart.toISOString().slice(0,10),
      end: wEnd.toISOString().slice(0,10),
      label: `${id} | ${fmtDate(wStart.toISOString().slice(0,10))} – ${fmtDate(wEnd.toISOString().slice(0,10))}`
    });
    cur.setDate(cur.getDate()+7);
    i++;
  }
  return weeks;
}

export function isOverdue(task, todayIso){
  if(!task?.endDate) return false;
  const status = task.status || "Planned";
  if(["Done","Cancelled"].includes(status)) return false;
  return task.endDate < todayIso;
}

export function statusClass(status){
  switch(status){
    case "Planned": return "planned";
    case "In Progress": return "progress";
    case "Done": return "done";
    case "Delayed": return "delayed";
    case "Cancelled": return "cancel";
    default: return "planned";
  }
}

export function statusLabel(status){
  const m = {
    "Planned":"مخطط",
    "In Progress":"قيد التنفيذ",
    "Done":"مكتمل",
    "Delayed":"متأخر/مؤجل",
    "Cancelled":"ملغى"
  };
  return m[status] || status || "—";
}



// ---- Calendar helpers ----
export function iso(d){
  return d.toISOString().slice(0,10);
}

export function startOfMonth(d){
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0,0,0,0);
  return x;
}

export function endOfMonth(d){
  const x = new Date(d.getFullYear(), d.getMonth()+1, 0);
  x.setHours(0,0,0,0);
  return x;
}

// In Iraq, week often starts Saturday; but for familiarity we use Sunday in UI.
// We'll render DOW labels as: أحد..سبت
export const DOW_AR = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

export function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}

export function sameIso(aIso, bIso){
  return String(aIso||"") === String(bIso||"");
}
