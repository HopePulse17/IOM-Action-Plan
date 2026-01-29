# HPF Workplan – Web App (GitHub Pages + Firebase) – v3

منصة خفيفة وحديثة (RTL) لمتابعة **تنفيذ الأنشطة** أسبوعياً/يومياً (تحديث لحظي) عبر Firebase Firestore.

✅ **هذه المنصة لا تتضمن الميزانية أو المشتريات** (حسب طلبكم) — هي فقط للمتابعة والتنفيذ.

---

## أهم الميزات
- **Dashboard**: مؤشرات سريعة + المتأخر + إضافة سريعة.
- **الخطة الأسبوعية**: فلترة حسب أسبوع/موقع/مسؤول + تعديل مباشر.
- **التقويم**: عرض شهري شبيه Google Calendar (خفيف) + أجندة يومية.
- **المخرجات**: ملخص تقدم Outputs 1–4 + فتح تفاصيل كل مخرج.
- **المهام/الأنشطة**: فلترة قوية + بحث.
- **Kanban**: مخطط/قيد التنفيذ/مكتمل/متأخر/ملغى.
- **الإشعارات**: عند إسناد مهمة أو تغيير حالتها.
- **التقارير**: تصدير Excel/CSV بالعربية (RTL).
- **الإعدادات (Admin/Manager)**: تعديل القوائم + إدارة دليل المستخدمين (UID/Role/Location).

---

## الأدوار والصلاحيات (Role-Based)
داخل Firestore لكل مستخدم يوجد ملف: `users/{uid}`

- **admin / manager**: يرى ويعدل كل شيء + الإعدادات + التصدير.
- **coordinator**: يرى أنشطة موقعه فقط (defaultLocation) ويعدل ضمن موقعه.
- **specialist**: يرى ويعدل **المهام المسندة له فقط** (assigneeUid).
- **viewer**: قراءة فقط (ضمن موقعه).

> ملاحظة: من الواجهة لا يمكن إنشاء حسابات Authentication بشكل آمن بدون Backend.  
> لذلك: **إنشاء حساب (Email/Password) يتم من Firebase Console** ثم يضيف المدير UID في المنصة لتفعيل الدور/الموقع.

---

## 1) إنشاء مشروع Firebase (خطوة بخطوة)
1) افتح Firebase Console → Create project.
2) من **Authentication**:
   - Sign-in method → فعّل **Email/Password**.
3) من **Firestore Database**:
   - Create database → Start in production mode.
4) أنشئ مستخدم Admin أول مرة:
   - Authentication → Users → Add user (email/password).
   - انسخ **UID**.
   - Firestore → ابدأ بإنشاء وثيقة:
     - Collection: `users`
     - Document ID: (UID)
     - Fields:
       - `name`: "مدير المشروع"
       - `role`: "admin"
       - `defaultLocation`: "" (اختياري)
       - `active`: true

> بعد ذلك، ادخل المنصة وسجّل دخولك، ثم من **الإعدادات** يمكنك إضافة بقية المستخدمين (بعد إنشاء حساباتهم في Auth).

---

## 2) إعداد قواعد Firestore (Security Rules)
ضع القواعد التالية في: Firestore → Rules

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }

    function userDoc() { return get(/databases/$(database)/documents/users/$(request.auth.uid)); }
    function isActive() { return signedIn() && userDoc().exists() && userDoc().data.active == true; }
    function role() { return userDoc().data.role; }
    function defLoc() { return userDoc().data.defaultLocation; }

    function isAdmin() { return isActive() && (role() in ['admin','manager']); }
    function isCoordinator() { return isActive() && role() == 'coordinator'; }
    function isSpecialist() { return isActive() && role() == 'specialist'; }
    function isViewer() { return isActive() && role() == 'viewer'; }

    // ----- settings -----
    match /settings/{docId} {
      allow read: if isActive();
      allow write: if isAdmin();
    }

    // ----- users & directory -----
    match /users/{uid} {
      allow read: if isActive() && (isAdmin() || request.auth.uid == uid);
      allow write: if isAdmin();
    }
    match /directory/{uid} {
      allow read: if isActive(); // لعرض قائمة الإسناد داخل المنصة (يمكن تضييقها إذا رغبت)
      allow write: if isAdmin();
    }

    // ----- tasks -----
    match /tasks/{taskId} {
      allow read: if isAdmin()
                  || (isCoordinator() && resource.data.location == defLoc())
                  || (isViewer() && resource.data.location == defLoc())
                  || (isSpecialist() && resource.data.assigneeUid == request.auth.uid)
                  || (isActive() && resource.data.assigneeUid == request.auth.uid);

      allow create: if isAdmin()
                    || (isCoordinator() && request.resource.data.location == defLoc())
                    || (isSpecialist() && request.resource.data.assigneeUid == request.auth.uid);

      allow update: if isAdmin()
                    || (isCoordinator() && resource.data.location == defLoc())
                    || (isSpecialist() && resource.data.assigneeUid == request.auth.uid);

      allow delete: if isAdmin();
    }

    // ----- notifications -----
    match /notifications/{id} {
      allow read: if isActive() && resource.data.toUid == request.auth.uid;
      allow create: if isActive(); // إنشاء إشعارات من التطبيق
      allow update: if isActive() && resource.data.toUid == request.auth.uid; // mark read
      allow delete: if isAdmin();
    }
  }
}
```

> إذا ظهرت رسالة تحتاج Index (مؤشر)، افتح رابط إنشاء الـ Index من Firebase Console واضغط Create.

---

## 3) إعداد Firebase Config داخل المشروع
افتح الملف:
`js/firebase-config.js`

واستبدل القيم بمعلومات مشروعك من Firebase → Project settings → Web app config.

---

## 4) نشر المشروع على GitHub Pages
1) أنشئ Repository جديد على GitHub.
2) ارفع محتويات هذا المجلد (index.html + assets + js + README).
3) Settings → Pages:
   - Source: Deploy from a branch
   - Branch: main / (root)
4) افتح رابط GitHub Pages الناتج.

---

## 5) إضافة المستخدمين (Admin فقط)
1) Firebase Console → Authentication → Add user (email/password).
2) انسخ UID.
3) داخل المنصة → **الإعدادات** → "دليل المستخدمين":
   - ألصق UID + الاسم + الإيميل + Role + defaultLocation + Active=true
   - اضغط "حفظ/تحديث المستخدم"

---

## 6) كيفية الاستخدام سريعاً
- من **التقويم**: اختر يوم → افتح الأجندة → (إضافة نشاط) أو (تعديل نشاط).
- من **الخطة الأسبوعية**: فلتر حسب الأسبوع/الموقع/المسؤول.
- حدث دائماً:
  - الحالة (Planned/In Progress/Done/Delayed/Cancelled)
  - نسبة الإنجاز
  - الاحتياجات/التحديات
  - روابط الأدلة

---

## الهيكل داخل Firestore
- `tasks` : جميع الأنشطة
- `notifications` : إشعارات لكل مستخدم
- `users/{uid}` : صلاحيات المستخدم + defaultLocation + active
- `directory/{uid}` : دليل للمستخدمين (لربط الإسناد/الإشعارات)
- `settings/lists` : قوائم منسدلة + outputActivities

