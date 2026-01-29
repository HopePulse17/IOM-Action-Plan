import { auth, authApi } from './firebase.js';
import { $, $$, toast } from './utils.js';
import {
  store,
  loadTasksRealtime,
  loadListsRealtime,
  loadDirectoryRealtime,
  loadUserProfile,
  loadNotificationsRealtime,
  canAdmin,
  unreadCount
} from './store.js';
import { route } from './router.js';
import {
  initViews,
  viewAuth, bindAuth,
  viewDashboard, bindDashboard,
  viewWeekly, bindWeekly,
  viewCalendar, bindCalendar,
  viewOutputs, bindOutputs,
  viewTasks, bindTasks,
  viewKanban, bindKanban,
  viewReports, bindReports,
  viewNotifications, bindNotifications,
  viewSettings, bindSettings,
  exportAllNow
} from './views.js';

const content = document.getElementById("content");
const sidebar = document.getElementById("sidebar");
const btnLogout = document.getElementById("btnLogout");
const userBadge = document.getElementById("userBadge");
const btnExport = document.getElementById("btnExport");
const btnBell = document.getElementById("btnBell");
const bellDot = document.getElementById("bellDot");

initViews();

// ----- Auth -----
authApi.onAuthStateChanged(auth, async (user)=>{
  store.user = user || null;

  if(user){
    sidebar.classList.remove("hidden");
    btnLogout.classList.remove("hidden");
    btnExport.classList.remove("hidden");
    btnBell.classList.remove("hidden");
    userBadge.classList.remove("hidden");
    userBadge.textContent = user.email || "user";

    // load profile + settings
    loadUserProfile(user.uid);
    await loadListsRealtime();

    // directory is admin-only
    loadDirectoryRealtime();

    // tasks scoped by role (after profile arrives). We'll load once now and reload when profile updates
    loadTasksRealtime();

    // notifications
    loadNotificationsRealtime();

    if(!location.hash) location.hash = "#/dashboard";
    route();
  } else {
    sidebar.classList.add("hidden");
    btnLogout.classList.add("hidden");
    btnExport.classList.add("hidden");
    btnBell.classList.add("hidden");
    userBadge.classList.add("hidden");
    bellDot.classList.add("hidden");

    content.innerHTML = viewAuth();
    bindAuth({
      onLogin: async (email, pass)=>{
        if(!email || !pass){ toast("أدخل البريد وكلمة المرور"); return; }
        try{
          await authApi.signInWithEmailAndPassword(auth, email, pass);
        }catch(e){
          console.error(e);
          toast("تعذر تسجيل الدخول. تحقق من البيانات.");
        }
      },
      onHow: ()=>{
        alert(
          "١) سجّل الدخول\n" +
          "٢) افتح (التقويم) لمعرفة أنشطة الأيام\n" +
          "٣) افتح (الخطة الأسبوعية) لرؤية الأسبوع بسرعة\n" +
          "٤) افتح أي نشاط وحدّث (الحالة) و(نسبة الإنجاز)\n" +
          "٥) استخدم الفلاتر لموقعك/مسؤولك\n" +
          "٦) صدّر Excel من (التقارير) أو زر (تصدير)"
        );
      }
    });
  }
});

// logout
btnLogout.addEventListener("click", async ()=>{
  try{ await authApi.signOut(auth); }
  catch(e){ console.error(e); }
});

// export
btnExport.addEventListener("click", ()=> exportAllNow());

// notifications icon
btnBell.addEventListener("click", ()=>{ location.hash = "#/notifications"; });

// Router
window.addEventListener("hashchange", route);

window.addEventListener("route:change", (e)=>{
  const hash = e.detail.hash || "#/dashboard";
  if(!store.user){
    content.innerHTML = viewAuth();
    return;
  }

  // hide/show admin links
  $$(".admin-only").forEach(a=> a.classList.toggle("hidden", !canAdmin()));

  // profile activation guard
  if(store.profile && store.profile.active === false){
    content.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div>
            <div class="page-title">الحساب غير مُفعّل</div>
            <div class="page-sub">يرجى مراجعة مدير المشروع لتفعيل الحساب (Active) وتحديد الدور والموقع.</div>
          </div>
        </div>
        <div class="card">
          <div class="page-sub">Email: ${store.user.email || ""}</div>
          <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
            <button class="btn btn-primary" id="btnSignOutNow">تسجيل خروج</button>
          </div>
        </div>
      </div>`;
    const b = document.getElementById("btnSignOutNow");
    if(b) b.onclick = ()=> authApi.signOut(auth);
    return;
  }

  const [path] = hash.replace("#/","").split("?");
  if(path==="dashboard"){ content.innerHTML = viewDashboard(); bindDashboard(content); }
  else if(path==="weekly"){ content.innerHTML = viewWeekly(); bindWeekly(content); }
  else if(path==="calendar"){ content.innerHTML = viewCalendar(); bindCalendar(content); }
  else if(path==="outputs"){ content.innerHTML = viewOutputs(); bindOutputs(content); }
  else if(path==="tasks"){ content.innerHTML = viewTasks(); bindTasks(content); }
  else if(path==="kanban"){ content.innerHTML = viewKanban(); bindKanban(content); }
  else if(path==="reports"){ content.innerHTML = viewReports(); bindReports(content); }
  else if(path==="notifications"){ content.innerHTML = viewNotifications(); bindNotifications(content); }
  else if(path==="settings"){ content.innerHTML = viewSettings(); bindSettings(content); }
  else { location.hash = "#/dashboard"; }
});

// re-render current view when data changes
function rerender(){
  if(!store.user) return;
  const hash = location.hash || "#/dashboard";
  window.dispatchEvent(new CustomEvent("route:change", { detail:{ hash } }));
}

window.addEventListener("tasks:updated", rerender);
window.addEventListener("lists:updated", rerender);
window.addEventListener("directory:updated", rerender);
window.addEventListener("profile:updated", ()=>{
  // update badge role
  if(store.user) userBadge.textContent = `${store.user.email || "user"} • ${store.profile.role || "member"}`;
  // reload tasks with new profile scope
  if(store.user) loadTasksRealtime();
  rerender();
});

// update bell dot
window.addEventListener("noti:updated", ()=>{
  const count = unreadCount();
  bellDot.classList.toggle("hidden", !(count > 0));
  // also update notifications view if open
  rerender();
});
