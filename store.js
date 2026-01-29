// Central store: realtime tasks + settings + notifications + directory (admin)
import { db, fs } from './firebase.js';
import { genWeeks, toast } from './utils.js';

export const WEEKS = genWeeks();

// قوائم افتراضية (يمكن للـ Admin تعديلها)
const defaultLists = {
  locations: ["القائم","الرمانة","حديثة"],
  outputs: ["Output 1","Output 2","Output 3","Output 4"],
  // لكل Output يمكن إضافة قائمة أنشطة مقترحة (اختياري)
  outputActivities: {
    "Output 1": [],
    "Output 2": [],
    "Output 3": [],
    "Output 4": []
  },
  activityTypes: ["جلسات مجتمعية (PSS)","جلسات نساء","نوادي قراءة","رياضة للشباب","خدمة مجتمعية","حوار مجتمعي","تدريب/جلسة أخرى"],
  targetGroups: ["رجال","نساء","أطفال","يافعين","أهالي","مختلط"],
  priorities: ["عالي","متوسط","منخفض"],
  statuses: ["Planned","In Progress","Done","Delayed","Cancelled"],
  // أسماء عرض فقط (الربط بحساب يتم عبر assigneeUid)
  owners: ["مدير المشروع","منسق القائم","منسق الرمانة","منسق حديثة","PSS Coordinator","Case Management Specialist","Communications Officer"],
  governmentBodies: [] // اختياري: جهات حكومية متكررة
};

export const store = {
  user: null,
  profile: { role: "member", name: "", defaultLocation: "", active: true },
  tasks: [],
  notifications: [],
  directory: [], // لصفحة الإعدادات/الربط (Admin)
  lists: JSON.parse(JSON.stringify(defaultLists)),
  unsub: { tasks:null, lists:null, profile:null, noti:null, dir:null }
};

// ---- Roles helpers ----
export function role(){
  return store.profile?.role || "member";
}
export function canAdmin(){
  return ["admin","manager"].includes(role());
}
export function isViewer(){
  return role() === "viewer";
}
export function isCoordinator(){
  return role() === "coordinator";
}
export function isSpecialist(){
  return role() === "specialist";
}

// ---- Profile (users/{uid}) ----
export async function loadUserProfile(uid){
  const ref = fs.doc(db, "users", uid);
  if(store.unsub.profile) store.unsub.profile();
  store.unsub.profile = fs.onSnapshot(ref, (snap)=>{
    if(snap.exists()){
      store.profile = Object.assign({ role:"member", active:true }, snap.data());
    } else {
      // إذا لا يوجد ملف مستخدم => يعتبر غير مُعتمد
      store.profile = { role:"member", active:false, name:"", defaultLocation:"" };
    }
    window.dispatchEvent(new CustomEvent("profile:updated"));
  }, (err)=>{
    console.warn(err);
    toast("تعذر تحميل ملف المستخدم. تحقق من الاتصال.");
  });
}

// ---- Lists (settings/lists) ----
export async function loadListsRealtime(){
  const ref = fs.doc(db, "settings", "lists");
  if(store.unsub.lists) store.unsub.lists();
  store.unsub.lists = fs.onSnapshot(ref, (snap)=>{
    if(snap.exists()){
      const d = snap.data() || {};
      store.lists = Object.assign({}, defaultLists, d);
      // merge outputActivities defaults
      store.lists.outputActivities = Object.assign({}, defaultLists.outputActivities, (d.outputActivities||{}));
    } else {
      // seed defaults once
      fs.setDoc(ref, defaultLists, { merge:true }).catch(()=>{});
      store.lists = JSON.parse(JSON.stringify(defaultLists));
    }
    window.dispatchEvent(new CustomEvent("lists:updated"));
  }, (err)=>{
    console.warn(err);
    toast("تعذر تحميل الإعدادات.");
  });
}

// ---- Directory (directory collection) – Admin tool for mapping UID/name ----
export function loadDirectoryRealtime(){
  if(!canAdmin()){
    // no directory for non-admin
    store.directory = [];
    window.dispatchEvent(new CustomEvent("directory:updated"));
    return;
  }
  const col = fs.collection(db, "directory");
  const q = fs.query(col, fs.orderBy("name","asc"));
  if(store.unsub.dir) store.unsub.dir();
  store.unsub.dir = fs.onSnapshot(q, (snap)=>{
    const items = [];
    snap.forEach(d=> items.push({ uid:d.id, ...d.data() }));
    store.directory = items;
    window.dispatchEvent(new CustomEvent("directory:updated"));
  }, (err)=>{
    console.warn(err);
    toast("تعذر تحميل دليل المستخدمين.");
  });
}

// ---- Tasks (tasks collection) with per-role scoped query ----
export function loadTasksRealtime(){
  if(store.unsub.tasks) store.unsub.tasks();

  const col = fs.collection(db, "tasks");
  let q;

  if(canAdmin()){
    q = fs.query(col, fs.orderBy("updatedAt","desc"));
  } else if(isSpecialist()){
    // specialist sees only assigned tasks
    q = fs.query(col, fs.where("assigneeUid","==", store.user.uid), fs.orderBy("updatedAt","desc"));
  } else {
    // coordinator/viewer/member: by defaultLocation
    const loc = store.profile.defaultLocation || "";
    if(!loc){
      // fallback: show assigned only
      q = fs.query(col, fs.where("assigneeUid","==", store.user.uid), fs.orderBy("updatedAt","desc"));
    } else {
      q = fs.query(col, fs.where("location","==", loc), fs.orderBy("updatedAt","desc"));
    }
  }

  store.unsub.tasks = fs.onSnapshot(q, (snap)=>{
    const items = [];
    snap.forEach(d=> items.push({ id:d.id, ...d.data() }));
    store.tasks = items;
    window.dispatchEvent(new CustomEvent("tasks:updated"));
  }, (err)=>{
    console.warn(err);
    toast("تعذر تحميل الأنشطة. تحقق من الصلاحيات/قواعد Firestore.");
  });
}

// ---- Notifications (notifications where toUid==uid) ----
export function loadNotificationsRealtime(){
  if(store.unsub.noti) store.unsub.noti();

  const col = fs.collection(db, "notifications");
  const q = fs.query(col, fs.where("toUid","==", store.user.uid), fs.orderBy("createdAt","desc"));
  store.unsub.noti = fs.onSnapshot(q, (snap)=>{
    const items = [];
    snap.forEach(d=> items.push({ id:d.id, ...d.data() }));
    store.notifications = items;
    window.dispatchEvent(new CustomEvent("noti:updated"));
  }, (err)=>{
    console.warn(err);
    // notifications are optional; don't block
  });
}

export function unreadCount(){
  return store.notifications.filter(n=> !n.read).length;
}
