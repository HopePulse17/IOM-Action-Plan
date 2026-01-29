import {
  $, $$, escapeHtml, fmtDate, clamp, toast,
  genWeeks, isOverdue, statusClass, statusLabel,
  startOfMonth, endOfMonth, addDays, iso, DOW_AR
} from './utils.js';

import { store, WEEKS, canAdmin, isViewer, isCoordinator, isSpecialist, unreadCount } from './store.js';
import { db, fs } from './firebase.js';

// ---------------- Shared UI helpers ----------------
function pageShell({title, sub, actionsHtml, bodyHtml}){
  return `
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">${escapeHtml(title||"")}</div>
        ${sub ? `<div class="page-sub">${escapeHtml(sub)}</div>` : ``}
      </div>
      <div class="page-actions">${actionsHtml || ""}</div>
    </div>
    ${bodyHtml || ""}
  </div>`;
}

function todayIso(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function weekById(id){ return WEEKS.find(w=> w.id===id); }

function progressBar(p){
  const v = clamp(parseInt(p||0,10)||0, 0, 100);
  return `<div class="progress" title="${v}%"><div style="width:${v}%"></div></div>`;
}

function statusPill(status){
  const cls = statusClass(status);
  return `<span class="status ${cls}">${statusLabel(status)}</span>`;
}

function calcKpis(tasks){
  const t = tasks.length;
  const done = tasks.filter(x=>x.status==="Done").length;
  const inprog = tasks.filter(x=>x.status==="In Progress").length;
  const over = tasks.filter(x=> isOverdue(x, todayIso())).length;
  return { t, done, inprog, over };
}

function selectOptions(arr, selected){
  return (arr||[]).map(v=> `<option ${String(v)===String(selected)?"selected":""} value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function weekOptions(selected){
  return WEEKS.map(w=> `<option ${w.id===selected?"selected":""} value="${w.id}">${escapeHtml(w.label)}</option>`).join("");
}

function modalOpen(title, bodyHtml, footHtml){
  const m = document.getElementById("modal");
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHtml;
  $("#modalFoot").innerHTML = footHtml || "";
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden","false");
}

export function modalClose(){
  const m = document.getElementById("modal");
  m.classList.add("hidden");
  m.setAttribute("aria-hidden","true");
  $("#modalBody").innerHTML = "";
  $("#modalFoot").innerHTML = "";
}

function bindModalClose(){
  $("#modalClose").onclick = modalClose;
  $("#modal").addEventListener("click", (e)=>{
    if(e.target?.dataset?.close) modalClose();
  });
}

function findDirectoryUser(uid){
  return store.directory.find(u=> u.uid===uid);
}

function ownerLabelForTask(t){
  if(t.ownerName) return t.ownerName;
  const du = t.assigneeUid ? findDirectoryUser(t.assigneeUid) : null;
  return du?.name || du?.email || "—";
}

function canEditTask(task){
  if(isViewer()) return false;
  if(canAdmin()) return true;

  // specialist can edit only assigned
  if(isSpecialist()){
    return (task.assigneeUid && task.assigneeUid === store.user.uid);
  }

  // coordinator/member: only in their location OR assigned to them
  const loc = store.profile.defaultLocation || "";
  if(task.assigneeUid && task.assigneeUid === store.user.uid) return true;
  if(loc && task.location === loc) return true;
  return false;
}

function canCreateTask(){
  if(isViewer()) return false;
  return true;
}

// ---------------- Notification helpers ----------------
async function createNotification({ toUid, taskId, title, message, type="task" }){
  if(!toUid || toUid === store.user.uid) return;
  try{
    await fs.addDoc(fs.collection(db,"notifications"), {
      toUid,
      taskId,
      title,
      message,
      type,
      read: false,
      createdAt: fs.serverTimestamp(),
      fromEmail: store.user?.email || "unknown"
    });
  }catch(e){
    // silent
    console.warn("notify failed", e);
  }
}

// ---------------- Task Form ----------------
function outputActivityOptions(output, selected){
  const map = store.lists.outputActivities || {};
  const arr = map[output] || [];
  const base = [`<option value="">—</option>`];
  const opts = arr.map(x=> `<option ${x===selected?"selected":""} value="${escapeHtml(x)}">${escapeHtml(x)}</option>`);
  opts.push(`<option ${selected==="أخرى"?"selected":""} value="أخرى">أخرى</option>`);
  return base.concat(opts).join("");
}

function directoryOptions(selectedUid){
  // Admin only: allow mapping to a real account for notifications
  const active = (store.directory||[]).filter(u=> u.active !== false);
  return [`<option value="">—</option>`].concat(
    active.map(u=>{
      const label = `${u.name || u.email || u.uid} (${u.role||"member"})`;
      return `<option ${u.uid===selectedUid?"selected":""} value="${escapeHtml(u.uid)}">${escapeHtml(label)}</option>`;
    })
  ).join("");
}

function taskForm(task={}){
  const lists = store.lists;
  const isAdmin = canAdmin();

  return `
  <div class="grid" style="grid-template-columns:1fr 1fr; gap:12px">
    <div class="field">
      <label>رمز/كود النشاط (اختياري)</label>
      <input class="input" id="fCode" value="${escapeHtml(task.taskCode||"")}" placeholder="مثال: HAD-W05-01" />
    </div>
    <div class="field">
      <label>عنوان النشاط/المهمة</label>
      <input class="input" id="fTitle" value="${escapeHtml(task.title||"")}" placeholder="مثال: جلسة دعم PSS – حديثة" />
    </div>

    <div class="field">
      <label>المخرج (Output)</label>
      <select id="fOutput">${selectOptions(lists.outputs, task.output||"")}</select>
    </div>
    <div class="field">
      <label>نشاط ضمن المخرج (اختياري)</label>
      <select id="fOutAct"></select>
    </div>

    <div class="field">
      <label>نوع النشاط</label>
      <select id="fType">${selectOptions(lists.activityTypes, task.activityType||"")}</select>
    </div>
    <div class="field">
      <label>الفئة المستهدفة</label>
      <select id="fTarget">${selectOptions(lists.targetGroups, task.targetGroup||"")}</select>
    </div>

    <div class="field">
      <label>الموقع</label>
      <select id="fLocation">${selectOptions(lists.locations, task.location||"")}</select>
    </div>
    <div class="field">
      <label>الجهة الحكومية المعنية (اختياري)</label>
      ${lists.governmentBodies?.length
        ? `<select id="fGov">${selectOptions([""].concat(lists.governmentBodies), task.governmentBody||"")}</select>`
        : `<input class="input" id="fGov" value="${escapeHtml(task.governmentBody||"")}" placeholder="مثال: قائمقامية حديثة / الشرطة..." />`
      }
    </div>

    <div class="field">
      <label>الأسبوع (Week ID)</label>
      <select id="fWeek">${weekOptions(task.weekId||"")}</select>
    </div>
    <div class="field">
      <label>الأولوية</label>
      <select id="fPriority">${selectOptions(lists.priorities, task.priority||"متوسط")}</select>
    </div>

    <div class="field">
      <label>تاريخ البداية</label>
      <input class="input" id="fStart" type="date" value="${escapeHtml(task.startDate||"")}" />
    </div>
    <div class="field">
      <label>تاريخ النهاية</label>
      <input class="input" id="fEnd" type="date" value="${escapeHtml(task.endDate||"")}" />
    </div>

    <div class="field">
      <label>الحالة</label>
      <select id="fStatus">${selectOptions(lists.statuses, task.status||"Planned")}</select>
    </div>
    <div class="field">
      <label>نسبة الإنجاز (0–100)</label>
      <input class="input" id="fProgress" type="number" min="0" max="100" value="${escapeHtml(String(task.progress ?? 0))}" />
    </div>

    <div class="field">
      <label>المسؤول (اسم للعرض)</label>
      <select id="fOwnerName">${selectOptions(lists.owners, task.ownerName||"")}</select>
      <div class="page-sub">يُستخدم للفلترة/التقارير. (لا علاقة له بالصلاحيات)</div>
    </div>

    <div class="field">
      <label>ربط بحساب لاستلام الإشعارات (Admin فقط)</label>
      ${isAdmin
        ? `<select id="fAssignee">${directoryOptions(task.assigneeUid||"")}</select>
           <div class="page-sub">يتطلب إدخال UID للمستخدم داخل "الإعدادات".</div>`
        : `<input class="input" disabled value="غير متاح (Admin فقط)" />`
      }
    </div>
  </div>

  <div class="split" style="margin-top:12px">
    <div class="field">
      <label>الاحتياجات/اللوجستك</label>
      <textarea id="fNeeds" placeholder="قاعة، نقل، مواد، موافقات...">${escapeHtml(task.needs||"")}</textarea>
    </div>
    <div class="field">
      <label>التحديات/المخاطر</label>
      <textarea id="fChallenges" placeholder="تأخير موافقة، صعوبة استهداف، أحوال جوية...">${escapeHtml(task.challenges||"")}</textarea>
    </div>
  </div>

  <div class="split" style="margin-top:12px">
    <div class="field">
      <label>روابط الأدلة (سطر لكل رابط)</label>
      <textarea id="fEvidence" placeholder="ضع رابط Google Drive/Photos/Attendance...">${escapeHtml((task.evidenceLinks||[]).join("\n"))}</textarea>
    </div>
    <div class="field">
      <label>ملاحظات إضافية</label>
      <textarea id="fNotes" placeholder="أي تفاصيل إضافية...">${escapeHtml(task.notes||"")}</textarea>
    </div>
  </div>
  `;
}

function taskDetails(task){
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start">
        <div>
          <div style="font-weight:900; font-size:16px">${escapeHtml(task.title||"")}</div>
          <div class="page-sub">${escapeHtml(task.taskCode||"—")} • ${escapeHtml(task.location||"—")} • ${escapeHtml(task.output||"—")}</div>
        </div>
        ${statusPill(task.status)}
      </div>

      <div style="margin-top:10px">${progressBar(task.progress||0)}</div>

      <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
        <div class="card">
          <div class="page-sub">المسؤول</div>
          <div style="font-weight:900">${escapeHtml(ownerLabelForTask(task))}</div>
        </div>
        <div class="card">
          <div class="page-sub">التواريخ</div>
          <div style="font-weight:900">${fmtDate(task.startDate)} – ${fmtDate(task.endDate)}</div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
        <div class="card">
          <div class="page-sub">الاحتياجات</div>
          <div style="white-space:pre-wrap">${escapeHtml(task.needs||"—")}</div>
        </div>
        <div class="card">
          <div class="page-sub">التحديات</div>
          <div style="white-space:pre-wrap">${escapeHtml(task.challenges||"—")}</div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
        <div class="card">
          <div class="page-sub">روابط الأدلة</div>
          ${(task.evidenceLinks||[]).length
            ? `<ul style="margin:6px 0 0; padding-right:18px">${(task.evidenceLinks||[]).map(x=>`<li><a target="_blank" rel="noopener" href="${escapeHtml(x)}">${escapeHtml(x)}</a></li>`).join("")}</ul>`
            : `<div>—</div>`
          }
        </div>
        <div class="card">
          <div class="page-sub">ملاحظات</div>
          <div style="white-space:pre-wrap">${escapeHtml(task.notes||"—")}</div>
        </div>
      </div>
    </div>
  `;
}

async function saveTask(taskId=null){
  const title = $("#fTitle").value.trim();
  if(!title){ toast("اكتب عنوان النشاط"); return; }

  const weekId = $("#fWeek").value;
  const w = weekById(weekId);

  const isAdmin = canAdmin();
  const assigneeUid = isAdmin ? ($("#fAssignee").value || "") : (store.user?.uid || "");

  const data = {
    taskCode: $("#fCode").value.trim(),
    title,
    output: $("#fOutput").value,
    outputActivity: $("#fOutAct").value || "",
    activityType: $("#fType").value,
    targetGroup: $("#fTarget").value,
    location: $("#fLocation").value,
    governmentBody: ($("#fGov").value||"").trim(),
    weekId,
    priority: $("#fPriority").value,
    startDate: $("#fStart").value || (w?.start || ""),
    endDate: $("#fEnd").value || (w?.end || ""),
    status: $("#fStatus").value,
    progress: clamp(parseInt($("#fProgress").value||"0",10)||0, 0, 100),
    ownerName: $("#fOwnerName").value,
    assigneeUid: assigneeUid || "",
    needs: $("#fNeeds").value.trim(),
    challenges: $("#fChallenges").value.trim(),
    evidenceLinks: $("#fEvidence").value.split("\n").map(x=>x.trim()).filter(Boolean),
    notes: $("#fNotes").value.trim(),
    updatedAt: fs.serverTimestamp(),
    updatedBy: store.user?.email || "unknown"
  };

  // Permission guard (UI)
  if(taskId){
    const old = store.tasks.find(t=> t.id===taskId);
    if(old && !canEditTask(old)){
      toast("لا تملك صلاحية تعديل هذا النشاط");
      return;
    }
  } else {
    if(!canCreateTask()){
      toast("لا تملك صلاحية إضافة نشاط");
      return;
    }
    // coordinator/member auto lock location to defaultLocation if exists
    if(!canAdmin() && store.profile.defaultLocation){
      data.location = store.profile.defaultLocation;
    }
  }

  try{
    if(taskId){
      const old = store.tasks.find(t=> t.id===taskId) || {};
      await fs.updateDoc(fs.doc(db, "tasks", taskId), data);

      // notifications on assignment/status change
      const assignedChanged = (old.assigneeUid||"") !== (data.assigneeUid||"") && data.assigneeUid;
      const statusChanged = (old.status||"") !== (data.status||"");
      if(assignedChanged){
        await createNotification({
          toUid: data.assigneeUid,
          taskId,
          title: "تم إسناد مهمة لك",
          message: `${data.title} • ${data.location} • ${statusLabel(data.status)}`
        });
      } else if(statusChanged && data.assigneeUid){
        await createNotification({
          toUid: data.assigneeUid,
          taskId,
          title: "تحديث حالة مهمة",
          message: `${data.title} → ${statusLabel(data.status)}`
        });
      }

      toast("تم تحديث النشاط");
    } else {
      const docRef = await fs.addDoc(fs.collection(db, "tasks"), Object.assign({}, data, {
        createdAt: fs.serverTimestamp(),
        createdBy: store.user?.email || "unknown"
      }));

      // notify assignee
      if(data.assigneeUid){
        await createNotification({
          toUid: data.assigneeUid,
          taskId: docRef.id,
          title: "مهمة جديدة",
          message: `${data.title} • ${data.location} • ${fmtDate(data.startDate)}`
        });
      }

      toast("تمت إضافة النشاط");
    }
    modalClose();
  }catch(e){
    console.error(e);
    toast("تعذر الحفظ. تحقق من الصلاحيات/الاتصال.");
  }
}

async function deleteTask(taskId){
  if(!canAdmin()){
    toast("الحذف متاح للمدير فقط");
    return;
  }
  if(!confirm("هل تريد حذف هذا النشاط؟")) return;
  try{
    await fs.deleteDoc(fs.doc(db,"tasks",taskId));
    toast("تم الحذف");
    modalClose();
  }catch(e){
    console.error(e);
    toast("تعذر الحذف");
  }
}

function openTaskModal(task){
  const isNew = !task?.id;
  const editable = isNew ? canCreateTask() : canEditTask(task);

  if(!editable){
    modalOpen("عرض النشاط", taskDetails(task), `<button class="btn btn-soft" id="btnClose">إغلاق</button>`);
    $("#btnClose").onclick = ()=> modalClose();
    return;
  }

  modalOpen(
    isNew ? "إضافة نشاط" : "تعديل نشاط",
    taskForm(task||{}),
    `
      <button class="btn btn-primary" id="btnSave">حفظ</button>
      ${(!isNew && canAdmin()) ? `<button class="btn btn-danger" id="btnDel">حذف</button>` : ``}
      <button class="btn btn-soft" id="btnCancel">إلغاء</button>
    `
  );

  // bind outputActivity select
  const outSel = $("#fOutput");
  const outActSel = $("#fOutAct");
  function refreshOutAct(){
    outActSel.innerHTML = outputActivityOptions(outSel.value, task.outputActivity||"");
  }
  outSel.addEventListener("change", refreshOutAct);
  refreshOutAct();

  // auto lock location for coordinators
  if(!canAdmin() && store.profile.defaultLocation){
    $("#fLocation").value = store.profile.defaultLocation;
    $("#fLocation").disabled = true;
  }

  // save/delete/cancel
  $("#btnCancel").onclick = ()=> modalClose();
  $("#btnSave").onclick = ()=> saveTask(task?.id || null);
  if(!isNew && canAdmin()){
    $("#btnDel").onclick = ()=> deleteTask(task.id);
  }
}

// ---------------- Views ----------------
export function initViews(){
  bindModalClose();
}

export function viewDashboard(){
  const tasks = store.tasks;
  const k = calcKpis(tasks);
  const body = `
    <div class="grid kpis">
      <div class="card kpi"><div><div class="label">إجمالي الأنشطة</div><div class="value">${k.t}</div></div><div class="dot"></div></div>
      <div class="card kpi"><div><div class="label">مكتمل</div><div class="value">${k.done}</div></div><div class="dot" style="background: var(--good)"></div></div>
      <div class="card kpi"><div><div class="label">قيد التنفيذ</div><div class="value">${k.inprog}</div></div><div class="dot" style="background: var(--warn)"></div></div>
      <div class="card kpi"><div><div class="label">متأخر</div><div class="value">${k.over}</div></div><div class="dot" style="background: var(--bad)"></div></div>
    </div>

    <div class="grid" style="grid-template-columns: 1.2fr .8fr; margin-top:12px">
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
          <div>
            <div style="font-weight:900">المتأخر/يحتاج إجراء</div>
            <div class="page-sub">أنشطة تجاوزت تاريخ النهاية ولم تُغلق.</div>
          </div>
          <span class="chip">${k.over}</span>
        </div>

        <div style="margin-top:10px" class="table-wrap">
          <table>
            <thead><tr>
              <th>النشاط</th><th>الموقع</th><th>المسؤول</th><th>نهاية</th><th>الحالة</th>
            </tr></thead>
            <tbody>
              ${tasks.filter(x=> isOverdue(x, todayIso())).slice(0,8).map(t=>`
                <tr data-id="${t.id}" class="row-task">
                  <td>${escapeHtml(t.title||"")}</td>
                  <td>${escapeHtml(t.location||"")}</td>
                  <td>${escapeHtml(ownerLabelForTask(t))}</td>
                  <td>${fmtDate(t.endDate)}</td>
                  <td>${statusPill(t.status)}</td>
                </tr>
              `).join("") || `<tr><td colspan="5" style="color:var(--muted)">لا يوجد متأخر ✅</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:900">إضافة سريعة</div>
        <div class="page-sub">لإضافة نشاط للأسبوع الحالي بسرعة.</div>

        <div style="margin-top:10px" class="field">
          <label>الأسبوع</label>
          <select id="dashWeek">${WEEKS.map(w=>`<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("")}</select>
        </div>

        <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">
          <button class="btn btn-primary" id="dashAdd">+ إضافة نشاط</button>
          <a class="btn btn-soft" href="#/calendar">فتح التقويم</a>
        </div>

        <div style="margin-top:12px" class="hint">
          <div class="hint-title">نصيحة</div>
          <div class="hint-text">غيّر الحالة ونسبة الإنجاز باستمرار — هذا يعطي صورة فورية للمدير.</div>
        </div>
      </div>
    </div>
  `;

  return pageShell({
    title:"لوحة المتابعة",
    sub:`حالة التنفيذ لحظياً. دورك الحالي: ${escapeHtml(store.profile.role || "member")}`,
    actionsHtml: canCreateTask() ? `<button class="btn btn-primary" id="addTask">+ إضافة نشاط</button>` : ``,
    bodyHtml: body
  });
}

export function bindDashboard(root){
  root.querySelectorAll(".row-task").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const id = tr.dataset.id;
      const task = store.tasks.find(t=>t.id===id);
      if(task) openTaskModal(task);
    });
  });

  if($("#addTask")) $("#addTask").onclick = ()=> openTaskModal({});
  $("#dashAdd").onclick = ()=>{
    const wId = $("#dashWeek").value;
    openTaskModal({ weekId:wId, location: store.profile.defaultLocation || "" });
  };
}

// Weekly
export function viewWeekly(){
  const body = `
    <div class="filters">
      <div class="field">
        <label>الأسبوع</label>
        <select id="wWeek">
          <option value="">الكل</option>
          ${WEEKS.map(w=>`<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>الموقع</label>
        <select id="wLoc">
          <option value="">الكل</option>
          ${store.lists.locations.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>المسؤول</label>
        <select id="wOwner">
          <option value="">الكل</option>
          ${store.lists.owners.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>بحث</label>
        <input class="input" id="wQ" placeholder="عنوان/كود/جهة..." />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        ${canCreateTask() ? `<button class="btn btn-primary" id="wAdd">+ إضافة</button>` : ``}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>الكود</th>
            <th>العنوان</th>
            <th>الأسبوع</th>
            <th>الموقع</th>
            <th>المسؤول</th>
            <th>الحالة</th>
            <th>الإنجاز</th>
          </tr>
        </thead>
        <tbody id="wRows"></tbody>
      </table>
    </div>
  `;
  return pageShell({
    title:"الخطة الأسبوعية",
    sub:"عرض سريع لالتقاط الصورة الأسبوعية + تعديل مباشر للنشاط.",
    bodyHtml: body
  });
}

function renderWeeklyRows(){
  const wk = $("#wWeek").value;
  const loc = $("#wLoc").value;
  const owner = $("#wOwner").value;
  const q = ($("#wQ").value||"").trim().toLowerCase();

  const items = store.tasks.filter(t=>{
    if(wk && t.weekId!==wk) return false;
    if(loc && t.location!==loc) return false;
    if(owner && (t.ownerName||"")!==owner) return false;
    if(q){
      const s = `${t.title||""} ${t.taskCode||""} ${t.governmentBody||""} ${t.output||""}`.toLowerCase();
      if(!s.includes(q)) return false;
    }
    return true;
  });

  const rows = $("#wRows");
  rows.innerHTML = items.map(t=>`
    <tr class="row-task" data-id="${t.id}">
      <td>${escapeHtml(t.taskCode||"")}</td>
      <td>
        <div style="font-weight:800">${escapeHtml(t.title||"")}</div>
        <div class="page-sub">${escapeHtml(t.output||"")} • ${escapeHtml(t.outputActivity||"")}</div>
      </td>
      <td><span class="chip small">${escapeHtml(t.weekId||"")}</span></td>
      <td>${escapeHtml(t.location||"")}</td>
      <td>${escapeHtml(ownerLabelForTask(t))}</td>
      <td>${statusPill(t.status)}</td>
      <td>${progressBar(t.progress)}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="color:var(--muted)">لا يوجد نتائج</td></tr>`;

  rows.querySelectorAll(".row-task").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const task = store.tasks.find(x=>x.id===tr.dataset.id);
      if(task) openTaskModal(task);
    });
  });
}

export function bindWeekly(root){
  if($("#wAdd")) $("#wAdd").onclick = ()=> openTaskModal({});
  ["wWeek","wLoc","wOwner"].forEach(id=> $("#"+id).addEventListener("change", renderWeeklyRows));
  $("#wQ").addEventListener("input", renderWeeklyRows);
  renderWeeklyRows();
}

// Tasks
export function viewTasks(){
  const body = `
    <div class="filters">
      <div class="field">
        <label>الموقع</label>
        <select id="tLoc">
          <option value="">الكل</option>
          ${store.lists.locations.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>الأسبوع</label>
        <select id="tWeek">
          <option value="">الكل</option>
          ${WEEKS.map(w=>`<option value="${w.id}">${escapeHtml(w.id)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>الحالة</label>
        <select id="tStatus">
          <option value="">الكل</option>
          ${store.lists.statuses.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(statusLabel(x))}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>المخرج</label>
        <select id="tOutput">
          <option value="">الكل</option>
          ${store.lists.outputs.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>المسؤول</label>
        <select id="tOwner">
          <option value="">الكل</option>
          ${store.lists.owners.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>بحث</label>
        <input class="input" id="tQ" placeholder="عنوان/كود/جهة..." />
      </div>
      <div class="field" style="min-width:220px">
        <label>&nbsp;</label>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          ${canCreateTask() ? `<button class="btn btn-primary" id="tAdd">+ إضافة</button>` : ``}
          <button class="btn btn-soft" id="tClear">مسح</button>
          <button class="btn btn-soft" id="tMine">مهامي</button>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>الكود</th>
            <th>العنوان</th>
            <th>الموقع</th>
            <th>المسؤول</th>
            <th>التواريخ</th>
            <th>الحالة</th>
            <th>الإنجاز</th>
          </tr>
        </thead>
        <tbody id="tRows"></tbody>
      </table>
    </div>
  `;

  return pageShell({
    title:"المهام/الأنشطة",
    sub:"فلترة سريعة + تعديل مباشر. (المنصة لا تتعامل مع المشتريات/الميزانية)",
    bodyHtml: body
  });
}

function renderTaskRows(){
  const loc = $("#tLoc").value;
  const wk = $("#tWeek").value;
  const st = $("#tStatus").value;
  const out = $("#tOutput").value;
  const owner = $("#tOwner").value;
  const q = ($("#tQ").value||"").trim().toLowerCase();
  const today = todayIso();

  const items = store.tasks.filter(t=>{
    if(loc && t.location!==loc) return false;
    if(wk && t.weekId!==wk) return false;
    if(st && t.status!==st) return false;
    if(out && t.output!==out) return false;
    if(owner && (t.ownerName||"")!==owner) return false;
    if(q){
      const s = `${t.title||""} ${t.taskCode||""} ${t.governmentBody||""} ${t.outputActivity||""}`.toLowerCase();
      if(!s.includes(q)) return false;
    }
    return true;
  });

  const rows = $("#tRows");
  rows.innerHTML = items.map(t=>{
    const overdue = isOverdue(t, today);
    const date = `${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`;
    return `
      <tr class="row-task" data-id="${t.id}" style="${overdue ? 'background:#fff6f6' : ''}">
        <td>${escapeHtml(t.taskCode||"")}</td>
        <td>
          <div style="font-weight:800">${escapeHtml(t.title||"")}</div>
          <div class="page-sub">${escapeHtml(t.output||"")} • ${escapeHtml(t.outputActivity||"")}</div>
        </td>
        <td>${escapeHtml(t.location||"")}</td>
        <td>${escapeHtml(ownerLabelForTask(t))}</td>
        <td>${date}</td>
        <td>${statusPill(t.status)}</td>
        <td>${progressBar(t.progress)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" style="color:var(--muted)">لا توجد نتائج</td></tr>`;

  rows.querySelectorAll(".row-task").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const task = store.tasks.find(x=>x.id===tr.dataset.id);
      if(task) openTaskModal(task);
    });
  });
}

export function bindTasks(root){
  if($("#tAdd")) $("#tAdd").onclick = ()=> openTaskModal({});
  $("#tClear").onclick = ()=>{
    ["tLoc","tWeek","tStatus","tOutput","tOwner"].forEach(id=> $("#"+id).value="");
    $("#tQ").value="";
    renderTaskRows();
  };
  $("#tMine").onclick = ()=>{
    // show tasks assigned to current user if any; else filter by ownerName equals their name
    const myName = store.profile.name || "";
    $("#tOwner").value = myName && store.lists.owners.includes(myName) ? myName : "";
    $("#tQ").value="";
    renderTaskRows();
  };

  ["tLoc","tWeek","tStatus","tOutput","tOwner"].forEach(id=> $("#"+id).addEventListener("change", renderTaskRows));
  $("#tQ").addEventListener("input", renderTaskRows);
  renderTaskRows();
}

// Kanban
export function viewKanban(){
  const cols = [
    { key:"Planned", title:"مخطط" },
    { key:"In Progress", title:"قيد التنفيذ" },
    { key:"Done", title:"مكتمل" },
    { key:"Delayed", title:"متأخر/مؤجل" },
    { key:"Cancelled", title:"ملغى" },
  ];
  const body = `
    <div class="kanban">
      ${cols.map(c=>{
        const items = store.tasks.filter(t=> (t.status||"Planned")===c.key).slice(0,60);
        return `
          <div class="kan-col">
            <div class="kan-title">${escapeHtml(c.title)} <span class="chip small">${items.length}</span></div>
            ${items.map(t=>`
              <div class="kan-item" data-id="${t.id}">
                <div class="t">${escapeHtml(t.title||"")}</div>
                <div class="m">${escapeHtml(t.location||"")} • ${escapeHtml(ownerLabelForTask(t))}</div>
                <div style="margin-top:6px">${progressBar(t.progress)}</div>
              </div>
            `).join("") || `<div class="page-sub">لا يوجد</div>`}
          </div>
        `;
      }).join("")}
    </div>
  `;
  return pageShell({
    title:"لوحة الحالات (Kanban)",
    sub:"اضغط على البطاقة للتعديل/العرض.",
    actionsHtml: canCreateTask() ? `<button class="btn btn-primary" id="kAdd">+ إضافة نشاط</button>` : ``,
    bodyHtml: body
  });
}

export function bindKanban(root){
  if($("#kAdd")) $("#kAdd").onclick = ()=> openTaskModal({});
  root.querySelectorAll(".kan-item").forEach(div=>{
    div.addEventListener("click", ()=>{
      const id = div.dataset.id;
      const task = store.tasks.find(t=>t.id===id);
      if(task) openTaskModal(task);
    });
  });
}

// Outputs
export function viewOutputs(){
  const outs = store.lists.outputs || [];
  const body = `
    <div class="grid" style="grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px">
      ${outs.map(o=>{
        const items = store.tasks.filter(t=> t.output===o);
        const done = items.filter(x=>x.status==="Done").length;
        const pct = items.length ? Math.round(done*100/items.length) : 0;
        return `
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <div style="font-weight:900">${escapeHtml(o)}</div>
              <span class="chip small">${items.length} نشاط</span>
            </div>
            <div class="page-sub" style="margin-top:4px">مكتمل: ${done}</div>
            <div style="margin-top:10px">${progressBar(pct)}</div>
            <div style="display:flex; gap:10px; margin-top:10px">
              <button class="btn btn-soft" data-open-output="${escapeHtml(o)}">عرض التفاصيل</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>

    <div class="hint" style="margin-top:12px">
      <div class="hint-title">تتبع المخرجات</div>
      <div class="hint-text">كل نشاط مرتبط بمخرج (Output). يمكنك إضافة "نشاط ضمن المخرج" من الإعدادات لتوحيد التسميات.</div>
    </div>
  `;
  return pageShell({
    title:"المخرجات",
    sub:"ملخص سريع للتقدم حسب المخرج، مع إمكانية فتح تفاصيل كل مخرج.",
    bodyHtml: body
  });
}

function openOutputDetails(output){
  const items = store.tasks.filter(t=> t.output===output).sort((a,b)=> (a.weekId||"").localeCompare(b.weekId||""));
  modalOpen(
    `تفاصيل ${output}`,
    `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>العنوان</th><th>الأسبوع</th><th>الموقع</th><th>المسؤول</th><th>الحالة</th><th>الإنجاز</th>
          </tr></thead>
          <tbody>
            ${items.map(t=>`
              <tr class="row-task" data-id="${t.id}">
                <td>${escapeHtml(t.taskCode||"")}</td>
                <td>${escapeHtml(t.title||"")}</td>
                <td>${escapeHtml(t.weekId||"")}</td>
                <td>${escapeHtml(t.location||"")}</td>
                <td>${escapeHtml(ownerLabelForTask(t))}</td>
                <td>${statusPill(t.status)}</td>
                <td>${progressBar(t.progress)}</td>
              </tr>
            `).join("") || `<tr><td colspan="7" style="color:var(--muted)">لا توجد أنشطة</td></tr>`}
          </tbody>
        </table>
      </div>
    `,
    `<button class="btn btn-soft" id="outClose">إغلاق</button>`
  );
  $("#outClose").onclick = ()=> modalClose();
  $$("#modalBody .row-task").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const task = store.tasks.find(x=> x.id===tr.dataset.id);
      if(task) openTaskModal(task);
    });
  });
}

export function bindOutputs(root){
  root.querySelectorAll("[data-open-output]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      openOutputDetails(btn.dataset.openOutput);
    });
  });
}

// Calendar
export function viewCalendar(){
  const body = `
    <div class="cal-head">
      <div>
        <div class="cal-title" id="calTitle">—</div>
        <div class="page-sub">اضغط على يوم لعرض الأنشطة/إضافتها.</div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-soft" id="calPrev">◀</button>
        <button class="btn btn-soft" id="calToday">اليوم</button>
        <button class="btn btn-soft" id="calNext">▶</button>
        ${canCreateTask() ? `<button class="btn btn-primary" id="calAdd">+ إضافة</button>` : ``}
      </div>
    </div>

    <div class="cal-grid" id="calGrid">
      ${DOW_AR.map(d=>`<div class="cal-dow">${escapeHtml(d)}</div>`).join("")}
    </div>

    <div class="hint" style="margin-top:12px">
      <div class="hint-title">مثل Google Calendar (خفيف)</div>
      <div class="hint-text">يعرض المهام حسب الأيام بناءً على تاريخ البداية/النهاية، ويمكن فتح اليوم لمعرفة التفاصيل.</div>
    </div>
  `;
  return pageShell({
    title:"التقويم",
    sub:"عرض شهري + أجندة يومية داخل نافذة.",
    bodyHtml: body
  });
}

let _calMonth = new Date(); // runtime state

function monthName(d){
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function tasksOnDay(dayIso){
  return store.tasks.filter(t=>{
    if(!t.startDate && !t.endDate) return false;
    const s = t.startDate || t.endDate;
    const e = t.endDate || t.startDate;
    return dayIso >= s && dayIso <= e;
  });
}

function renderCalendar(){
  const grid = $("#calGrid");
  const title = $("#calTitle");
  if(!grid || !title) return;

  title.textContent = monthName(_calMonth);

  // remove existing day cells
  const keep = 7; // DOW row
  while(grid.children.length > keep){
    grid.removeChild(grid.lastChild);
  }

  const start = startOfMonth(_calMonth);
  const end = endOfMonth(_calMonth);
  // make grid start on Sunday
  const startDow = start.getDay(); // 0=Sun
  const gridStart = addDays(start, -startDow);

  // 6 weeks view (42 cells)
  const today = todayIso();
  for(let i=0;i<42;i++){
    const d = addDays(gridStart, i);
    const dIso = iso(d);
    const inMonth = d.getMonth() === _calMonth.getMonth();
    const isToday = dIso === today;

    const items = tasksOnDay(dIso).slice(0,3);
    const count = tasksOnDay(dIso).length;

    const pills = items.map(t=>`
      <div class="cal-pill">
        <div class="l">${escapeHtml(t.title||"")}</div>
        <div class="r">${escapeHtml(t.location||"")}</div>
      </div>
    `).join("");

    const cell = document.createElement("div");
    cell.className = "cal-day" + (inMonth ? "" : " muted") + (isToday ? " today" : "");
    cell.dataset.date = dIso;
    cell.innerHTML = `
      <div class="cal-num">
        <div>${escapeHtml(String(d.getDate()))}</div>
        ${count ? `<span class="chip small">${count}</span>` : `<span></span>`}
      </div>
      <div class="cal-badges">${pills}</div>
    `;
    cell.addEventListener("click", ()=> openDayAgenda(dIso));
    grid.appendChild(cell);
  }
}

function openDayAgenda(dayIso){
  const items = tasksOnDay(dayIso).sort((a,b)=> (a.startDate||"").localeCompare(b.startDate||""));
  modalOpen(
    `أجندة ${fmtDate(dayIso)}`,
    `
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px">
        <span class="chip">عدد الأنشطة: ${items.length}</span>
        ${canCreateTask() ? `<button class="btn btn-primary" id="dayAdd">+ إضافة نشاط لهذا اليوم</button>` : ``}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الكود</th><th>العنوان</th><th>الموقع</th><th>المسؤول</th><th>الحالة</th><th>الإنجاز</th></tr></thead>
          <tbody>
            ${items.map(t=>`
              <tr class="row-task" data-id="${t.id}">
                <td>${escapeHtml(t.taskCode||"")}</td>
                <td>${escapeHtml(t.title||"")}</td>
                <td>${escapeHtml(t.location||"")}</td>
                <td>${escapeHtml(ownerLabelForTask(t))}</td>
                <td>${statusPill(t.status)}</td>
                <td>${progressBar(t.progress)}</td>
              </tr>
            `).join("") || `<tr><td colspan="6" style="color:var(--muted)">لا توجد أنشطة لهذا اليوم</td></tr>`}
          </tbody>
        </table>
      </div>
    `,
    `<button class="btn btn-soft" id="dayClose">إغلاق</button>`
  );
  $("#dayClose").onclick = ()=> modalClose();
  if($("#dayAdd")){
    $("#dayAdd").onclick = ()=>{
      openTaskModal({ startDate: dayIso, endDate: dayIso, location: store.profile.defaultLocation || "" });
    };
  }
  $$("#modalBody .row-task").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const task = store.tasks.find(x=> x.id===tr.dataset.id);
      if(task) openTaskModal(task);
    });
  });
}

export function bindCalendar(root){
  $("#calPrev").onclick = ()=>{
    _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth()-1, 1);
    renderCalendar();
  };
  $("#calNext").onclick = ()=>{
    _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth()+1, 1);
    renderCalendar();
  };
  $("#calToday").onclick = ()=>{
    _calMonth = new Date();
    renderCalendar();
  };
  if($("#calAdd")){
    $("#calAdd").onclick = ()=> openTaskModal({ location: store.profile.defaultLocation || "" });
  }
  renderCalendar();
}

// Notifications page
export function viewNotifications(){
  const body = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap">
        <div>
          <div style="font-weight:900">الإشعارات</div>
          <div class="page-sub">عند إسناد مهمة لك أو تحديث حالتها.</div>
        </div>
        <span class="chip">غير مقروء: ${unreadCount()}</span>
      </div>

      <div style="margin-top:12px" class="table-wrap">
        <table>
          <thead>
            <tr><th>النوع</th><th>الرسالة</th><th>التاريخ</th><th>إجراء</th></tr>
          </thead>
          <tbody id="nRows"></tbody>
        </table>
      </div>
    </div>
  `;
  return pageShell({ title:"الإشعارات", sub:"مركز إشعارات الحساب.", bodyHtml: body });
}

function renderNotifications(){
  const rows = $("#nRows");
  if(!rows) return;
  const items = store.notifications || [];

  rows.innerHTML = items.map(n=>{
    const badge = n.read ? `<span class="chip small">مقروء</span>` : `<span class="chip small" style="border-color:#fecdd3; background:#fff1f2">جديد</span>`;
    const date = n.createdAt?.toDate ? fmtDate(n.createdAt.toDate().toISOString().slice(0,10)) : "—";
    return `
      <tr data-id="${n.id}" class="row-noti" style="${n.read ? '' : 'background:#fffafc'}">
        <td>${badge}</td>
        <td>
          <div style="font-weight:800">${escapeHtml(n.title||"")}</div>
          <div class="page-sub">${escapeHtml(n.message||"")}</div>
        </td>
        <td>${date}</td>
        <td>
          <button class="btn btn-soft" data-open-task="${escapeHtml(n.taskId||"")}">فتح المهمة</button>
          ${n.read ? `` : `<button class="btn btn-soft" data-mark-read="${escapeHtml(n.id)}">تعليم كمقروء</button>`}
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4" style="color:var(--muted)">لا توجد إشعارات</td></tr>`;

  rows.querySelectorAll("[data-open-task]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tid = btn.dataset.openTask;
      const task = store.tasks.find(t=> t.id===tid);
      if(task) openTaskModal(task);
      else toast("المهمة غير متاحة ضمن نطاق صلاحياتك");
    });
  });

  rows.querySelectorAll("[data-mark-read]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.markRead;
      try{
        await fs.updateDoc(fs.doc(db,"notifications", id), { read:true });
        toast("تم التحديث");
      }catch(e){
        console.error(e);
        toast("تعذر التحديث");
      }
    });
  });
}

export function bindNotifications(root){
  renderNotifications();
}

// Reports
export function viewReports(){
  const body = `
    <div class="card">
      <div style="font-weight:900">تصدير تقارير Excel</div>
      <div class="page-sub">اختر نطاق التقرير ثم صدّر ملف Excel عربي مرتب.</div>

      <div style="margin-top:12px" class="split">
        <div class="field">
          <label>اسم التقرير</label>
          <input class="input" id="repName" value="تقرير خطة العمل" />
        </div>
        <div class="field">
          <label>نطاق التصدير</label>
          <select id="repScope">
            <option value="all">كل الأنشطة</option>
            <option value="thisweek">الأسبوع الحالي</option>
            <option value="overdue">المتأخر فقط</option>
            <option value="done">المكتمل فقط</option>
          </select>
        </div>
      </div>

      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-primary" id="btnXlsx">تصدير Excel</button>
        <button class="btn btn-soft" id="btnCsv">تصدير CSV</button>
      </div>

      <div class="hint" style="margin-top:12px">
        <div class="hint-title">ملاحظة</div>
        <div class="hint-text">لا يوجد أي حقول للميزانية/المشتريات في هذه المنصة — هي للتنفيذ والمتابعة فقط.</div>
      </div>
    </div>
  `;
  return pageShell({ title:"التقارير", sub:"تصدير سريع بصيغة Excel/CSV.", bodyHtml: body });
}

function getCurrentWeekId(){
  const today = todayIso();
  const w = WEEKS.find(w=> today >= w.start && today <= w.end);
  return w?.id || WEEKS[0]?.id;
}

function scopeTasks(scope){
  const today = todayIso();
  if(scope==="thisweek"){
    const wid = getCurrentWeekId();
    return store.tasks.filter(t=> t.weekId===wid);
  }
  if(scope==="overdue"){
    return store.tasks.filter(t=> isOverdue(t, today));
  }
  if(scope==="done"){
    return store.tasks.filter(t=> t.status==="Done");
  }
  return store.tasks;
}

function exportExcelLike(type){
  const name = ($("#repName").value||"تقرير").trim() || "تقرير";
  const scope = $("#repScope").value;
  const items = scopeTasks(scope);

  const rows = items.map(t=>({
    "الأسبوع": t.weekId || "",
    "رمز النشاط": t.taskCode || "",
    "العنوان": t.title || "",
    "الموقع": t.location || "",
    "المسؤول": ownerLabelForTask(t),
    "المخرج": t.output || "",
    "نشاط ضمن المخرج": t.outputActivity || "",
    "نوع النشاط": t.activityType || "",
    "الفئة": t.targetGroup || "",
    "الجهة الحكومية": t.governmentBody || "",
    "تاريخ البداية": t.startDate ? fmtDate(t.startDate) : "",
    "تاريخ النهاية": t.endDate ? fmtDate(t.endDate) : "",
    "الحالة": statusLabel(t.status),
    "نسبة الإنجاز %": (t.progress ?? 0),
    "الاحتياجات": t.needs || "",
    "التحديات": t.challenges || "",
    "روابط الأدلة": (t.evidenceLinks||[]).join(" | "),
    "ملاحظات": t.notes || "",
    "آخر تحديث بواسطة": t.updatedBy || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader:false });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "خطة العمل");
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Views = [{ RTL:true }];

  if(type==="xlsx"){
    XLSX.writeFile(wb, `${name}.xlsx`);
  }else{
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    a.click();
  }
}

export function bindReports(root){
  $("#btnXlsx").onclick = ()=> exportExcelLike("xlsx");
  $("#btnCsv").onclick = ()=> exportExcelLike("csv");
}

// Settings (Admin)
export function viewSettings(){
  if(!canAdmin()){
    return pageShell({ title:"الإعدادات", sub:"غير مصرح.", bodyHtml:`<div class="card">غير مصرح.</div>` });
  }

  const lists = store.lists;

  const body = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">
        <div>
          <div style="font-weight:900">الإعدادات</div>
          <div class="page-sub">تعديل القوائم المنسدلة + دليل المستخدمين (لربط الإشعارات).</div>
        </div>
        <span class="chip">Admin/Manager</span>
      </div>

      <div style="margin-top:12px" class="split">
        ${listEditor("owners","المسؤولون (أسماء للعرض والفلترة)", lists.owners)}
        ${listEditor("locations","المواقع", lists.locations)}
      </div>

      <div style="margin-top:12px" class="split">
        ${listEditor("outputs","المخرجات (Outputs)", lists.outputs)}
        ${listEditor("activityTypes","أنواع الأنشطة", lists.activityTypes)}
      </div>

      <div style="margin-top:12px" class="split">
        ${listEditor("targetGroups","الفئات المستهدفة", lists.targetGroups)}
        ${listEditor("governmentBodies","جهات حكومية مقترحة (اختياري)", lists.governmentBodies||[])}
      </div>

      <div style="margin-top:12px" class="card" style="border-style:dashed">
        <div style="font-weight:900">أنشطة مقترحة لكل مخرج (اختياري)</div>
        <div class="page-sub">سطر لكل نشاط. يساعد على توحيد المسميات داخل "نشاط ضمن المخرج".</div>

        <div style="margin-top:10px" class="split">
          ${listEditorMap("Output 1")}
          ${listEditorMap("Output 2")}
        </div>
        <div style="margin-top:10px" class="split">
          ${listEditorMap("Output 3")}
          ${listEditorMap("Output 4")}
        </div>
      </div>

      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-primary" id="btnSaveLists">حفظ الإعدادات</button>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <div style="font-weight:900">دليل المستخدمين (لربط الإشعارات)</div>
      <div class="page-sub">
        <b>مهم:</b> إنشاء حساب المستخدم (Email/Password) يتم من Firebase Authentication (Console).  
        بعد ذلك انسخ <b>UID</b> وأضفه هنا لتفعيل الدور/الموقع/الإشعارات.
      </div>

      <div style="margin-top:10px" class="split">
        <div class="field"><label>UID (من Firebase Auth)</label><input class="input" id="uUid" placeholder="UID..." /></div>
        <div class="field"><label>الاسم</label><input class="input" id="uName" placeholder="مثال: منسق حديثة" /></div>
      </div>

      <div style="margin-top:10px" class="split">
        <div class="field"><label>Email</label><input class="input" id="uEmail" placeholder="name@email.com" /></div>
        <div class="field"><label>Role</label>
          <select id="uRole">
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="coordinator">coordinator</option>
            <option value="specialist">specialist</option>
            <option value="viewer">viewer</option>
          </select>
          <div class="page-sub">admin/manager: كل شيء • coordinator: ضمن موقعه • specialist: المهام المسندة فقط • viewer: قراءة فقط</div>
        </div>
      </div>

      <div style="margin-top:10px" class="split">
        <div class="field"><label>الموقع الافتراضي</label>
          <select id="uLoc">
            <option value="">—</option>
            ${lists.locations.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Active</label>
          <select id="uActive">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-primary" id="btnAddUser">حفظ/تحديث المستخدم</button>
      </div>

      <div style="margin-top:12px" class="table-wrap">
        <table>
          <thead><tr><th>UID</th><th>الاسم</th><th>Email</th><th>Role</th><th>Location</th><th>Active</th></tr></thead>
          <tbody id="dirRows"></tbody>
        </table>
      </div>
    </div>
  `;

  return pageShell({ title:"الإعدادات", sub:"إدارة القوائم + المستخدمين + ربط الإشعارات", bodyHtml: body });
}

function listEditor(key, title, arr){
  const val = (arr||[]).join("\n");
  return `
    <div class="field">
      <label>${escapeHtml(title)}</label>
      <textarea id="lst_${escapeHtml(key)}" style="min-height:140px" placeholder="سطر لكل عنصر">${escapeHtml(val)}</textarea>
      <div class="page-sub">اكتب كل عنصر في سطر مستقل.</div>
    </div>
  `;
}

function listEditorMap(outputKey){
  const arr = (store.lists.outputActivities||{})[outputKey] || [];
  const val = arr.join("\n");
  const safe = String(outputKey||"").replace(/\s+/g, "_");
  return `
    <div class="field">
      <label>${escapeHtml(outputKey)}</label>
      <textarea id="out_${safe}" style="min-height:140px" placeholder="سطر لكل نشاط">${escapeHtml(val)}</textarea>
    </div>
  `;
}

function parseLines(id){
  return $("#"+id).value.split("\n").map(x=>x.trim()).filter(Boolean);
}

function renderDirectoryRows(){
  const rows = $("#dirRows");
  if(!rows) return;
  const items = store.directory || [];
  rows.innerHTML = items.map(u=>`
    <tr>
      <td>${escapeHtml(u.uid||"")}</td>
      <td>${escapeHtml(u.name||"")}</td>
      <td>${escapeHtml(u.email||"")}</td>
      <td>${escapeHtml(u.role||"")}</td>
      <td>${escapeHtml(u.defaultLocation||"")}</td>
      <td>${escapeHtml(String(u.active!==false))}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="color:var(--muted)">لا يوجد</td></tr>`;
}

export function bindSettings(root){
  if(!canAdmin()) return;

  $("#btnSaveLists").onclick = async ()=>{
    const data = {
      owners: parseLines("lst_owners"),
      locations: parseLines("lst_locations"),
      outputs: parseLines("lst_outputs"),
      activityTypes: parseLines("lst_activityTypes"),
      targetGroups: parseLines("lst_targetGroups"),
      governmentBodies: parseLines("lst_governmentBodies"),
      // keep stable statuses/priorities (not editable here to avoid logic breaks)
      priorities: store.lists.priorities,
      statuses: store.lists.statuses,
      outputActivities: {
        "Output 1": parseLines("out_Output_1"),
        "Output 2": parseLines("out_Output_2"),
        "Output 3": parseLines("out_Output_3"),
        "Output 4": parseLines("out_Output_4")
      },
      updatedAt: fs.serverTimestamp(),
      updatedBy: store.user?.email || "unknown"
    };
    try{
      await fs.setDoc(fs.doc(db,"settings","lists"), data, { merge:true });
      toast("تم حفظ الإعدادات");
    }catch(e){
      console.error(e);
      toast("تعذر حفظ الإعدادات");
    }
  };

  $("#btnAddUser").onclick = async ()=>{
    const uid = $("#uUid").value.trim();
    if(!uid){ toast("أدخل UID"); return; }
    const rec = {
      name: $("#uName").value.trim(),
      email: $("#uEmail").value.trim(),
      role: $("#uRole").value,
      defaultLocation: $("#uLoc").value,
      active: $("#uActive").value === "true",
      updatedAt: fs.serverTimestamp(),
      updatedBy: store.user?.email || "unknown"
    };
    try{
      // directory for admin UI + assignment dropdown
      await fs.setDoc(fs.doc(db,"directory", uid), rec, { merge:true });
      // users profile doc for authorization/scope
      await fs.setDoc(fs.doc(db,"users", uid), rec, { merge:true });
      toast("تم حفظ المستخدم");
      $("#uUid").value=""; $("#uName").value=""; $("#uEmail").value="";
    }catch(e){
      console.error(e);
      toast("تعذر حفظ المستخدم");
    }
  };

  renderDirectoryRows();
}

// Auth view
export function viewAuth(){
  const body = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-title">تسجيل الدخول</div>
        <div class="auth-sub">
          منصة داخلية لمتابعة تنفيذ الأنشطة (تحديث لحظي).  
          إذا كان حسابك جديداً، يجب أن يقوم المدير بتفعيلك (Active) وإسناد دورك.
        </div>

        <div style="margin-top:12px" class="split">
          <div class="field">
            <label>البريد الإلكتروني</label>
            <input class="input" id="authEmail" placeholder="name@email.com" />
          </div>
          <div class="field">
            <label>كلمة المرور</label>
            <input class="input" id="authPass" type="password" placeholder="••••••••" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap">
          <button class="btn btn-primary" id="btnLogin">دخول</button>
          <button class="btn btn-soft" id="btnHow">كيف أبدأ؟</button>
        </div>

        <div class="hint" style="margin-top:12px">
          <div class="hint-title">مهم</div>
          <div class="hint-text">إذا ظهرت رسالة "غير مفعل" راجع مدير المشروع ليضيف UID الخاص بك في الإعدادات.</div>
        </div>
      </div>
    </div>
  `;
  return pageShell({ title:"", bodyHtml: body });
}

export function bindAuth({ onLogin, onHow }){
  $("#btnLogin").onclick = ()=>{
    const email = $("#authEmail").value.trim();
    const pass = $("#authPass").value;
    onLogin(email, pass);
  };
  $("#btnHow").onclick = ()=> onHow();
}

// Export helper used from topbar
export function exportAllNow(){
  const rows = store.tasks.map(t=>({
    "الأسبوع": t.weekId || "",
    "رمز النشاط": t.taskCode || "",
    "العنوان": t.title || "",
    "الموقع": t.location || "",
    "المسؤول": ownerLabelForTask(t),
    "الحالة": statusLabel(t.status),
    "نسبة الإنجاز %": (t.progress ?? 0),
    "تاريخ البداية": t.startDate ? fmtDate(t.startDate) : "",
    "تاريخ النهاية": t.endDate ? fmtDate(t.endDate) : "",
    "المخرج": t.output || "",
    "نشاط ضمن المخرج": t.outputActivity || "",
    "نوع النشاط": t.activityType || "",
    "الفئة": t.targetGroup || "",
    "الجهة الحكومية": t.governmentBody || "",
    "الاحتياجات": t.needs || "",
    "التحديات": t.challenges || "",
    "روابط الأدلة": (t.evidenceLinks||[]).join(" | "),
    "ملاحظات": t.notes || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "خطة العمل");
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Views = [{ RTL:true }];
  XLSX.writeFile(wb, `Workplan_${new Date().toISOString().slice(0,10)}.xlsx`);
}
