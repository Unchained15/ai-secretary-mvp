const STORAGE_KEY = "school-secretary-ai-mvp";
const SUPABASE_SCRIPT = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const GOOGLE_API_SCRIPT = "https://apis.google.com/js/api.js";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_CALENDAR_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const GOOGLE_SHEETS_DISCOVERY_DOC = "https://sheets.googleapis.com/$discovery/rest?version=v4";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets.readonly";
const GOOGLE_TOKEN_STORAGE_KEY = "school-secretary-google-token";

const today = new Date();
const isoToday = toISODate(today);
const tomorrow = addDays(today, 1);

const demoTaskTitles = new Set([
  "Finish university acceptance spreadsheet",
  "Email University of Leeds representative",
  "Prepare tomorrow's lesson on Human Development",
  "Update CIALFO documents",
  "Submit internship proposal",
  "Finish CAT4 report"
]);

const seedData = {
  tasks: [],
  schedule: [
    { id: crypto.randomUUID(), time: "08:00", title: "DP Psychology Year 1", location: "Room 204" },
    { id: crypto.randomUUID(), time: "10:00", title: "Student university check-in", location: "Counselling Office" },
    { id: crypto.randomUUID(), time: "14:00", title: "Parent consultation", location: "Conference Room" },
    { id: crypto.randomUUID(), time: "15:30", title: "Admin block", location: "Desk" }
  ],
  students: [],
  notes: [],
  assistant: [
    { role: "assistant", text: "Hi Michael. Ask me what you need to do today, or tell me to add a task, student follow-up, or note." }
  ]
};

let state = loadState();
let taskFilter = "all";
let supabaseClient = null;
let currentSession = null;
let currentUser = null;
let cloudReady = false;
let syncing = false;
let googleTokenClient = null;
let googleConfigured = false;
let googleReady = false;
let googleConnected = false;
let deadlineTaskId = "";

const viewTitles = {
  today: "Hi Michael",
  tasks: "Tasks",
  students: "Student Follow-ups",
  notes: "Meeting Notes",
  assistant: "Assistant"
};

document.addEventListener("DOMContentLoaded", async () => {
  wireNavigation();
  wireForms();
  renderAll();
  await initializeSupabase();
  await initializeGoogleCalendar();
});

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(seedData);
  try {
    return JSON.parse(saved);
  } catch {
    return structuredClone(seedData);
  }
}

async function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (cloudReady && currentUser && !syncing) {
    await syncCloudData();
  }
}

async function initializeSupabase() {
  const config = window.SECRETARY_CONFIG || {};
  const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  if (!hasConfig) {
    renderAuthState();
    return;
  }

  try {
    await loadScript(SUPABASE_SCRIPT);
    supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session || null;
    currentUser = currentSession?.user || null;
    cloudReady = Boolean(currentUser);

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentSession = session || null;
      currentUser = session?.user || null;
      cloudReady = Boolean(currentUser);
      if (!currentUser) {
        clearGoogleAccess();
      } else if (googleReady) {
        await restoreGoogleAccess();
      }
      if (cloudReady) {
        await loadCloudData();
      }
      renderAuthState();
    });

    if (currentUser) {
      await loadCloudData();
    }
    renderAuthState();
  } catch (error) {
    updateCloudStatus("Supabase unavailable", "offline");
    document.getElementById("signInButton").classList.add("hidden");
    document.getElementById("signOutButton").classList.add("hidden");
    console.warn(error);
  }
}

function renderAuthState() {
  const isConfigured = Boolean(supabaseClient);
  const isSignedIn = Boolean(currentUser);
  document.getElementById("signInButton").classList.toggle("hidden", !isConfigured || isSignedIn);
  document.getElementById("signOutButton").classList.toggle("hidden", !isSignedIn);

  if (!isConfigured) {
    updateCloudStatus("Local mode", "offline");
  } else if (isSignedIn) {
    updateCloudStatus("Online sync", "online");
  } else {
    updateCloudStatus("Supabase ready. Sign in to sync.", "standby");
  }
}

function updateCloudStatus(text, status) {
  const badge = document.getElementById("dataMode");
  badge.title = text;
  badge.setAttribute("aria-label", text);
  badge.classList.remove("online", "standby", "offline");
  badge.classList.add(status);
}

async function initializeGoogleCalendar() {
  const config = window.SECRETARY_CONFIG || {};
  googleConfigured = Boolean(config.GOOGLE_API_KEY && config.GOOGLE_CLIENT_ID);
  renderCalendarState();
  renderStudentSyncState();

  if (!googleConfigured) return;

  try {
    await Promise.all([
      loadScript(GOOGLE_API_SCRIPT),
      loadScript(GOOGLE_IDENTITY_SCRIPT)
    ]);

    await new Promise((resolve, reject) => {
      window.gapi.load("client", {
        callback: resolve,
        onerror: reject
      });
    });

    await window.gapi.client.init({
      apiKey: config.GOOGLE_API_KEY,
      discoveryDocs: [GOOGLE_CALENDAR_DISCOVERY_DOC, GOOGLE_SHEETS_DISCOVERY_DOC]
    });

    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: ""
    });

    googleReady = true;
    renderCalendarState();
    renderStudentSyncState();
    await restoreGoogleAccess();
  } catch (error) {
    googleReady = false;
    googleConnected = false;
    renderCalendarState("Calendar unavailable");
    renderStudentSyncState("Sheets unavailable");
    console.warn(error);
  }
}

function renderStudentSyncState(customLabel) {
  const label = document.getElementById("studentSyncState");
  const button = document.getElementById("importStudents");
  if (!label || !button) return;

  const config = window.SECRETARY_CONFIG || {};
  const hasSheet = Boolean(config.STUDENT_SHEET_ID && config.STUDENT_SHEET_RANGE);
  label.classList.remove("connected", "needs-setup");

  if (customLabel) {
    label.textContent = customLabel;
    label.classList.add("needs-setup");
    button.disabled = true;
    return;
  }

  if (!hasSheet) {
    label.textContent = "Sheet not set";
    label.classList.add("needs-setup");
    button.disabled = true;
    return;
  }

  if (!googleReady) {
    label.textContent = "Loading";
    button.disabled = true;
    return;
  }

  label.textContent = "Sheet ready";
  label.classList.add("connected");
  button.disabled = false;
}

function renderCalendarState(customLabel) {
  const stateLabel = document.getElementById("calendarState");
  const connectButton = document.getElementById("connectCalendar");
  const refreshButton = document.getElementById("refreshCalendar");
  if (!stateLabel || !connectButton || !refreshButton) return;

  stateLabel.classList.remove("connected", "needs-setup");

  if (customLabel) {
    stateLabel.textContent = customLabel;
    stateLabel.classList.add("needs-setup");
    connectButton.classList.remove("hidden");
    connectButton.disabled = true;
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleConfigured) {
    stateLabel.textContent = "Setup needed";
    stateLabel.classList.add("needs-setup");
    connectButton.classList.remove("hidden");
    connectButton.disabled = true;
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleReady) {
    stateLabel.textContent = "Loading";
    connectButton.classList.remove("hidden");
    connectButton.disabled = true;
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleConnected) {
    stateLabel.textContent = "Not connected";
    stateLabel.classList.add("needs-setup");
    connectButton.classList.remove("hidden");
    connectButton.disabled = false;
    refreshButton.classList.add("hidden");
    return;
  }

  stateLabel.textContent = "Google";
  stateLabel.classList.add("connected");
  connectButton.classList.add("hidden");
  connectButton.disabled = false;
  refreshButton.classList.remove("hidden");
  refreshButton.disabled = false;
}

async function connectGoogleCalendar() {
  await requestGoogleAccess(loadTodayCalendarEvents, "Calendar error");
}

function googleTokenStorageKey() {
  return `${GOOGLE_TOKEN_STORAGE_KEY}:${currentUser?.id || "local"}`;
}

function saveGoogleAccessToken(response) {
  if (!response?.access_token) return;
  const expiresInSeconds = Number(response.expires_in || 3600);
  localStorage.setItem(googleTokenStorageKey(), JSON.stringify({
    access_token: response.access_token,
    scope: response.scope || GOOGLE_SCOPES,
    token_type: response.token_type || "Bearer",
    expiresAt: Date.now() + (expiresInSeconds * 1000)
  }));
}

function readGoogleAccessToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(googleTokenStorageKey()));
    if (!saved?.access_token || !saved.expiresAt || saved.expiresAt <= Date.now() + 60000) {
      localStorage.removeItem(googleTokenStorageKey());
      return null;
    }
    return saved;
  } catch {
    localStorage.removeItem(googleTokenStorageKey());
    return null;
  }
}

function clearGoogleAccess() {
  if (window.gapi?.client) {
    window.gapi.client.setToken(null);
  }
  googleConnected = false;
  renderCalendarState();
  renderStudentSyncState();
}

async function restoreGoogleAccess() {
  if (!googleReady || !window.gapi?.client) return false;

  let token = readGoogleAccessToken();
  if (!token && currentSession?.provider_token) {
    token = {
      access_token: currentSession.provider_token,
      scope: GOOGLE_SCOPES,
      token_type: "Bearer",
      expires_in: 3600
    };
    saveGoogleAccessToken(token);
  }

  if (!token) return false;

  window.gapi.client.setToken(token);
  googleConnected = true;
  renderCalendarState();
  renderStudentSyncState();
  await loadTodayCalendarEvents();
  return true;
}

async function requestGoogleAccess(afterAccess, errorLabel) {
  if (!googleReady || !googleTokenClient) return;

  googleTokenClient.callback = async (response) => {
    if (response.error) {
      renderCalendarState(errorLabel);
      renderStudentSyncState(errorLabel);
      return;
    }
    saveGoogleAccessToken(response);
    googleConnected = true;
    renderCalendarState();
    renderStudentSyncState();
    await afterAccess();
  };

  const prompt = window.gapi.client.getToken() ? "" : "consent";
  googleTokenClient.requestAccessToken({ prompt });
}

async function loadTodayCalendarEvents() {
  if (!googleConnected) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  try {
    const response = await window.gapi.client.calendar.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      showDeleted: false,
      singleEvents: true,
      orderBy: "startTime"
    });

    const events = response.result.items || [];
    state.schedule = events.map(fromGoogleCalendarEvent);
    if (!state.schedule.length) {
      state.schedule = [
        { id: "google-empty", time: "Today", title: "No Google Calendar events today", location: "Google Calendar" }
      ];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  } catch (error) {
    if (error?.status === 401 || error?.result?.error?.code === 401) {
      localStorage.removeItem(googleTokenStorageKey());
      clearGoogleAccess();
      renderCalendarState("Reconnect needed");
    } else {
      renderCalendarState("Calendar error");
    }
    console.warn(error);
  }
}

function fromGoogleCalendarEvent(event) {
  const startValue = event.start?.dateTime || event.start?.date;
  const isAllDay = Boolean(event.start?.date);
  return {
    id: event.id,
    time: isAllDay ? "All day" : new Date(startValue).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    title: event.summary || "Untitled event",
    location: event.location || event.hangoutLink || "Google Calendar"
  };
}

async function importStudentsFromSheet() {
  const config = window.SECRETARY_CONFIG || {};
  if (!config.STUDENT_SHEET_ID || !config.STUDENT_SHEET_RANGE) {
    renderStudentSyncState("Sheet not set");
    return;
  }

  await requestGoogleAccess(async () => {
    try {
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: config.STUDENT_SHEET_ID,
        range: config.STUDENT_SHEET_RANGE
      });

      const rows = response.result.values || [];
      const imported = parseStudentSheetRows(rows);
      const removedBeforeImport = cleanupStudentRecords();
      if (removedBeforeImport.length) {
        await deleteCloudStudents(removedBeforeImport);
      }
      mergeImportedStudents(imported);
      const removedAfterImport = cleanupStudentRecords();
      if (removedAfterImport.length) {
        await deleteCloudStudents(removedAfterImport);
      }
      await saveState();
      renderAll();

      const label = document.getElementById("studentSyncState");
      const nonEmptyCount = rows.filter((row) => row.some((value) => String(value || "").trim())).length;
      label.textContent = imported.length ? `${imported.length} imported` : `0 imported (${nonEmptyCount} rows read)`;
      label.classList.toggle("connected", imported.length > 0);
      label.classList.toggle("needs-setup", imported.length === 0);
    } catch (error) {
      renderStudentSyncState("Sheet error");
      console.warn(error);
    }
  }, "Sheet error");
}

function parseStudentSheetRows(rows) {
  if (!rows.length) return [];
  const nonEmptyRows = rows.filter((row) => row.some((value) => String(value || "").trim()));
  if (!nonEmptyRows.length) return [];

  const headerInfo = findStudentHeaderRow(nonEmptyRows);
  const headers = headerInfo ? headerInfo.headers : [];
  const nameIndex = findHeaderIndex(headers, ["name", "student", "student name", "student's name", "students name"]);
  const classIndex = findHeaderIndex(headers, ["class", "homeroom", "section"]);
  const gradeIndex = findHeaderIndex(headers, ["grade", "year", "level"]);
  const parentNameIndex = findHeaderIndex(headers, ["parents name", "parent name", "guardian name"]);
  const parentEmailIndex = findHeaderIndex(headers, ["parents email", "parent email", "guardian email"]);
  const emailIndex = findHeaderIndex(headers, ["student email", "student e-mail", "email", "e-mail", "mail"]);
  const hasHeader = Boolean(headerInfo) && nameIndex >= 0;
  const dataRows = hasHeader ? nonEmptyRows.slice(headerInfo.index + 1) : nonEmptyRows;

  return dataRows
    .map((row) => {
      if (hasHeader) {
        return {
          name: String(row[nameIndex] || "").trim(),
          className: classIndex >= 0 ? String(row[classIndex] || "").trim() : "",
          grade: gradeIndex >= 0 ? String(row[gradeIndex] || "").trim() : "",
          parentName: parentNameIndex >= 0 ? String(row[parentNameIndex] || "").trim() : "",
          parentEmail: parentEmailIndex >= 0 ? String(row[parentEmailIndex] || "").trim() : "",
          email: emailIndex >= 0 ? String(row[emailIndex] || "").trim() : ""
        };
      }

      return {
        name: String(row[0] || "").trim(),
        grade: String(row[1] || "").trim(),
        className: String(row[2] || "").trim(),
        parentName: String(row[3] || "").trim(),
        parentEmail: String(row[4] || "").trim(),
        email: String(row[5] || "").trim()
      };
    })
    .filter((student) => normalizeText(student.name) !== "student's name")
    .filter((student) => normalizeText(student.name) !== "student name")
    .filter((student) => !isInvalidStudentRecord(student))
    .filter((student) => student.name);
}

function findStudentHeaderRow(rows) {
  const scanLimit = Math.min(rows.length, 20);
  for (let index = 0; index < scanLimit; index += 1) {
    const headers = rows[index].map((value) => normalizeHeader(value));
    const hasName = findHeaderIndex(headers, ["name", "student", "student name", "student's name", "students name"]) >= 0;
    const hasClassOrGrade = findHeaderIndex(headers, ["class", "homeroom", "section", "grade", "year", "level"]) >= 0;
    if (hasName && hasClassOrGrade) {
      return { index, headers };
    }
  }
  return null;
}

function findHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(normalizeHeader(header)));
}

function mergeImportedStudents(imported) {
  imported.forEach((student) => {
    const existing = state.students.find((item) => {
      const sameEmail = student.email && item.email && normalizeText(item.email) === normalizeText(student.email);
      const sameName = normalizeText(item.name) === normalizeText(student.name);
      return sameEmail || sameName;
    });

    if (existing) {
      existing.name = student.name;
      existing.className = student.className;
      existing.grade = student.grade;
      existing.parentName = student.parentName;
      existing.parentEmail = student.parentEmail;
      existing.email = student.email;
      existing.source = "google-sheet";
    } else {
      state.students.push({
        id: crypto.randomUUID(),
        name: student.name,
        className: student.className,
        grade: student.grade,
        parentName: student.parentName,
        parentEmail: student.parentEmail,
        email: student.email,
        studentStatus: "green",
        goal: "",
        nextAction: "",
        deadline: isoToday,
        notes: "",
        source: "google-sheet"
      });
    }
  });
}

function cleanupStudentRecords() {
  const invalidIds = new Set();
  state.students = state.students.filter((student) => {
    const invalid = isInvalidStudentRecord(student);
    if (invalid) invalidIds.add(student.id);
    return !invalid;
  });

  if (invalidIds.size) {
    state.notes = state.notes.map((note) => invalidIds.has(note.studentId) ? { ...note, studentId: "" } : note);
  }
  return [...invalidIds];
}

function cleanupDemoRecords() {
  const removedTaskIds = [];
  const removedNoteIds = [];

  state.tasks = state.tasks.filter((task) => {
    const isDemoTask = demoTaskTitles.has(task.title);
    if (isDemoTask) removedTaskIds.push(task.id);
    return !isDemoTask;
  });

  state.notes = state.notes.filter((note) => {
    const text = normalizeText(note.text);
    const isDemoNote = text.includes("student a wants mechanical engineering in australia");
    if (isDemoNote) removedNoteIds.push(note.id);
    return !isDemoNote;
  });

  return { taskIds: removedTaskIds, noteIds: removedNoteIds };
}

async function deleteCloudStudents(studentIds) {
  if (!supabaseClient || !currentUser || !studentIds.length) return;
  await supabaseClient.from("students").delete().in("id", studentIds);
}

async function deleteCloudTasks(taskIds) {
  if (!supabaseClient || !currentUser || !taskIds.length) return;
  await supabaseClient.from("tasks").delete().in("id", taskIds);
}

async function deleteCloudNotes(noteIds) {
  if (!supabaseClient || !currentUser || !noteIds.length) return;
  await supabaseClient.from("notes").delete().in("id", noteIds);
}

function isInvalidStudentRecord(student) {
  const name = normalizeHeader(student.name);
  const email = normalizeText(student.email);
  const demoNames = ["student a", "student b", "student c"];
  const demoEmails = ["student.a@school.edu", "student.b@school.edu", "student.c@school.edu"];
  const headerNames = ["name", "student", "student name", "student's name", "students name"];
  const titleFragments = ["all students", "student list", "2627"];

  if (!name) return true;
  if (demoNames.includes(name) || demoEmails.includes(email)) return true;
  if (headerNames.includes(name)) return true;
  if (titleFragments.some((fragment) => name.includes(fragment))) return true;

  const hasRealDetails = [student.className, student.grade, student.parentName, student.parentEmail, student.email].some((value) => normalizeText(value));
  return student.source === "google-sheet" && !hasRealDetails;
}

async function loadCloudData() {
  if (!supabaseClient || !currentUser) return;

  const [tasksResult, studentsResult, notesResult] = await Promise.all([
    supabaseClient.from("tasks").select("*").order("due_date", { ascending: true }),
    supabaseClient.from("students").select("*").order("deadline", { ascending: true }),
    supabaseClient.from("notes").select("*").order("created_at", { ascending: false })
  ]);

  const errors = [tasksResult.error, studentsResult.error, notesResult.error].filter(Boolean);
  if (errors.length) {
    state.assistant.push({
      role: "assistant",
      text: "I connected to Supabase, but I could not read the tables. Check that you ran supabase-schema.sql in the SQL editor."
    });
    renderAll();
    return;
  }

  const hasCloudData = tasksResult.data.length || studentsResult.data.length || notesResult.data.length;
  if (!hasCloudData) {
    await syncCloudData();
    return;
  }

  state = {
    ...state,
    tasks: tasksResult.data.map(fromCloudTask),
    students: studentsResult.data.map(fromCloudStudent),
    notes: notesResult.data.map(fromCloudNote)
  };
  const removedStudentIds = cleanupStudentRecords();
  const removedDemoIds = cleanupDemoRecords();
  if (removedStudentIds.length) {
    await deleteCloudStudents(removedStudentIds);
  }
  if (removedDemoIds.taskIds.length) {
    await deleteCloudTasks(removedDemoIds.taskIds);
  }
  if (removedDemoIds.noteIds.length) {
    await deleteCloudNotes(removedDemoIds.noteIds);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

async function syncCloudData() {
  if (!supabaseClient || !currentUser) return;
  syncing = true;
  try {
    const taskRows = state.tasks.map(toCloudTask);
    const studentRows = state.students.map(toCloudStudent);
    const noteRows = state.notes.map(toCloudNote);

    await Promise.all([
      taskRows.length ? supabaseClient.from("tasks").upsert(taskRows) : Promise.resolve(),
      studentRows.length ? supabaseClient.from("students").upsert(studentRows) : Promise.resolve(),
      noteRows.length ? supabaseClient.from("notes").upsert(noteRows) : Promise.resolve()
    ]);
  } finally {
    syncing = false;
  }
}

function toCloudTask(task) {
  return {
    id: task.id,
    owner_id: currentUser.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    due_date: task.due,
    status: task.status,
    student_id: task.studentId || null,
    needs_deadline: Boolean(task.needsDeadline),
    follow_up_task: Boolean(task.followUpTask),
    source: "app",
    updated_at: new Date().toISOString()
  };
}

function fromCloudTask(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    priority: row.priority,
    due: row.due_date,
    status: row.status,
    studentId: row.student_id || "",
    needsDeadline: Boolean(row.needs_deadline),
    followUpTask: Boolean(row.follow_up_task)
  };
}

function toCloudStudent(student) {
  return {
    id: student.id,
    owner_id: currentUser.id,
    display_name: student.name,
    class_name: student.className || "",
    grade: student.grade || "",
    parent_name: student.parentName || "",
    parent_email: student.parentEmail || "",
    email: student.email || "",
    student_status: student.studentStatus || "green",
    goal: student.goal,
    next_action: student.nextAction,
    deadline: student.deadline,
    notes: student.notes || "",
    updated_at: new Date().toISOString()
  };
}

function fromCloudStudent(row) {
  return {
    id: row.id,
    name: row.display_name,
    className: row.class_name || "",
    grade: row.grade || "",
    parentName: row.parent_name || "",
    parentEmail: row.parent_email || "",
    email: row.email || "",
    studentStatus: row.student_status || "green",
    goal: row.goal || "",
    nextAction: row.next_action || "",
    deadline: row.deadline || isoToday,
    notes: row.notes || ""
  };
}

function toCloudNote(note) {
  return {
    id: note.id,
    owner_id: currentUser.id,
    student_id: note.studentId || null,
    follow_up_note_id: note.followUpNoteId || null,
    status_update: note.statusUpdate || null,
    note_type: note.type,
    body: note.text,
    created_at: note.createdAt
  };
}

function fromCloudNote(row) {
  return {
    id: row.id,
    studentId: row.student_id || "",
    followUpNoteId: row.follow_up_note_id || "",
    statusUpdate: row.status_update || "",
    type: row.note_type,
    text: row.body,
    createdAt: row.created_at
  };
}

function renderAll() {
  cleanupStudentRecords();
  cleanupDemoRecords();
  document.getElementById("todayDate").textContent = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(today);
  renderBriefing();
  renderSchedule();
  renderPriorities();
  renderFollowups();
  renderTasks();
  renderStudents();
  renderStudentOptions();
  renderFollowUpOptions();
  renderNotes();
  renderAssistant();
  renderCounts();
}

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      taskFilter = button.dataset.filter;
      document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderTasks();
    });
  });
}

function wireForms() {
  const taskDialog = document.getElementById("taskDialog");
  const deadlineDialog = document.getElementById("deadlineDialog");
  const studentDialog = document.getElementById("studentDialog");
  const authDialog = document.getElementById("authDialog");

  document.getElementById("quickAddTask").addEventListener("click", openTaskDialog);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = button.closest("dialog");
      const form = button.closest("form");
      if (form) form.reset();
      if (dialog) dialog.close();
      deadlineTaskId = "";
      renderFollowUpOptions();
    });
  });
  document.getElementById("signInButton").addEventListener("click", () => authDialog.showModal());
  document.getElementById("signOutButton").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    currentSession = null;
    currentUser = null;
    cloudReady = false;
    renderAuthState();
  });
  document.getElementById("addStudent").addEventListener("click", () => {
    document.getElementById("studentDeadline").value = isoToday;
    studentDialog.showModal();
  });

  document.getElementById("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("authMessage");
    if (!supabaseClient) {
      message.textContent = "Supabase is not configured yet. Fill in config.js first.";
      return;
    }

    const email = document.getElementById("authEmail").value.trim();
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    });

    message.textContent = error ? error.message : "Magic link sent. Check your email, then return here.";
    if (!error) {
      setTimeout(() => authDialog.close(), 1500);
    }
  });

  document.getElementById("googleSignIn").addEventListener("click", async () => {
    const message = document.getElementById("authMessage");
    if (!supabaseClient) {
      message.textContent = "Supabase is not configured yet. Fill in config.js first.";
      return;
    }

    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: GOOGLE_SCOPES
      }
    });

    if (error) {
      message.textContent = error.message;
    }
  });

  document.getElementById("taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.tasks.push({
      id: crypto.randomUUID(),
      title: document.getElementById("taskTitle").value.trim(),
      category: document.getElementById("taskCategory").value,
      priority: document.getElementById("taskPriority").value,
      due: document.getElementById("taskDue").value,
      status: "Open",
      studentId: "",
      needsDeadline: false,
      followUpTask: false
    });
    event.target.reset();
    await saveState();
    taskDialog.close();
    renderAll();
  });

  document.getElementById("deadlineForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      deadlineTaskId = "";
      deadlineDialog.close();
      return;
    }
    const task = state.tasks.find((item) => item.id === deadlineTaskId);
    if (!task) return;
    task.due = document.getElementById("deadlineDate").value;
    task.needsDeadline = false;
    await saveState();
    deadlineTaskId = "";
    deadlineDialog.close();
    renderAll();
  });

  document.getElementById("studentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.students.push({
      id: crypto.randomUUID(),
      name: document.getElementById("studentName").value.trim(),
      className: document.getElementById("studentClass").value.trim(),
      grade: document.getElementById("studentGrade").value.trim(),
      parentName: document.getElementById("studentParentName").value.trim(),
      parentEmail: document.getElementById("studentParentEmail").value.trim(),
      email: document.getElementById("studentEmail").value.trim(),
      goal: document.getElementById("studentGoal").value.trim(),
      nextAction: document.getElementById("studentAction").value.trim(),
      deadline: document.getElementById("studentDeadline").value,
      notes: ""
    });
    event.target.reset();
    await saveState();
    studentDialog.close();
    renderAll();
  });

  document.getElementById("noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = document.getElementById("noteText").value.trim();
    const type = document.getElementById("noteType").value;
    const studentId = document.getElementById("noteStudent").value;
    const statusUpdate = document.getElementById("noteStatus").value;
    const followUpNoteId = document.getElementById("followUpSource").value;
    if (!text) return;
    if ((type === "Follow-up" || statusUpdate) && !studentId) {
      document.getElementById("noteStudent").focus();
      return;
    }
    if (type === "Follow-up" && !followUpNoteId) {
      document.getElementById("followUpSource").focus();
      return;
    }
    await addNote(text, type, true, studentId, statusUpdate, followUpNoteId);
    event.target.reset();
    renderFollowUpOptions();
  });

  document.getElementById("assistantForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("assistantInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await handleAssistant(text);
  });

  document.getElementById("generateBriefing").addEventListener("click", renderBriefing);
  document.getElementById("studentSearch").addEventListener("input", renderStudents);
  document.getElementById("noteStudent").addEventListener("change", renderFollowUpOptions);
  document.getElementById("noteType").addEventListener("change", renderFollowUpOptions);
  document.getElementById("connectCalendar").addEventListener("click", connectGoogleCalendar);
  document.getElementById("refreshCalendar").addEventListener("click", loadTodayCalendarEvents);
  document.getElementById("importStudents").addEventListener("click", importStudentsFromSheet);
}

function showView(viewId) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.getElementById("viewTitle").textContent = viewTitles[viewId];
}

function openTaskDialog() {
  document.getElementById("taskDue").value = isoToday;
  document.getElementById("taskDialog").showModal();
}

function renderBriefing() {
  const todaysTasks = openTasks().filter((task) => task.due === isoToday);
  const overdue = getOverdueTasks();
  const nextEvent = state.schedule[0];
  const topTask = sortTasks(todaysTasks)[0] || sortTasks(openTasks())[0];
  const parts = [
    `Today you have ${state.schedule.length} calendar items and ${todaysTasks.length} task${todaysTasks.length === 1 ? "" : "s"} due.`,
    nextEvent ? `First up: ${nextEvent.time} ${nextEvent.title}.` : "No scheduled events are loaded yet.",
    topTask ? `Priority: ${topTask.title}.` : "No open priority tasks.",
    overdue.length ? `You also have ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} that need attention.` : "No overdue tasks. Nice clean slate."
  ];
  document.getElementById("briefingText").textContent = parts.join(" ");
}

function renderSchedule() {
  const list = document.getElementById("scheduleList");
  list.innerHTML = "";
  state.schedule.forEach((item) => {
    list.appendChild(elementFromHTML(`
      <article class="timeline-item">
        <div class="time">${escapeHTML(item.time)}</div>
        <div>
          <strong>${escapeHTML(item.title)}</strong>
          <div class="muted">${escapeHTML(item.location)}</div>
        </div>
      </article>
    `));
  });
  const next = state.schedule[0];
  document.getElementById("nextEventLabel").textContent = next ? `Next: ${next.time}` : "No events";
}

function renderPriorities() {
  const list = document.getElementById("priorityList");
  list.innerHTML = "";
  sortTasks(openTasks()).slice(0, 5).forEach((task) => list.appendChild(taskCard(task)));
}

function renderFollowups() {
  const list = document.getElementById("followupList");
  list.innerHTML = "";
  [...state.students]
    .filter((student) => ["yellow", "red"].includes(student.studentStatus))
    .sort((a, b) => statusRank(a.studentStatus) - statusRank(b.studentStatus) || a.name.localeCompare(b.name))
    .slice(0, 3)
    .forEach((student) => list.appendChild(studentCard(student)));
}

function statusRank(status) {
  return { red: 0, yellow: 1, green: 2 }[status || "green"] ?? 3;
}

function renderTasks() {
  const table = document.getElementById("taskTable");
  table.innerHTML = "";
  getFilteredTasks().forEach((task) => {
    const row = elementFromHTML(`
      <tr>
        <td><strong>${escapeHTML(task.title)}</strong></td>
        <td>${escapeHTML(task.category)}</td>
        <td><span class="pill ${task.priority.toLowerCase()}">${escapeHTML(task.priority)}</span></td>
        <td>${renderTaskDue(task)}</td>
        <td><button class="status-button ${task.status === "Done" ? "done" : ""}" data-task="${task.id}">${escapeHTML(task.status)}</button></td>
      </tr>
    `);
    row.querySelector("[data-task]").addEventListener("click", () => toggleTask(task.id));
    const deadlineButton = row.querySelector("[data-deadline-task]");
    if (deadlineButton) {
      deadlineButton.addEventListener("click", () => openDeadlineDialog(task.id));
    }
    table.appendChild(row);
  });
}

function renderStudents() {
  const query = document.getElementById("studentSearch").value.trim().toLowerCase();
  const grid = document.getElementById("studentGrid");
  grid.innerHTML = "";

  const students = state.students
    .filter((student) => [student.name, student.className, student.grade, student.parentName, student.parentEmail, student.email, student.goal, student.nextAction, student.notes].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!students.length) {
    grid.appendChild(elementFromHTML(`
      <article class="empty-state">
        <strong>No students yet</strong>
        <span>Import your Google Sheet to fill this list.</span>
      </article>
    `));
    return;
  }

  const gradeGroups = groupStudents(students, (student) => student.grade || "No grade");
  [...gradeGroups.entries()]
    .sort(([gradeA], [gradeB]) => compareGroupLabel(gradeA, gradeB))
    .forEach(([grade, gradeStudents]) => {
      const gradeSection = elementFromHTML(`
        <details class="student-grade" open>
          <summary>
            <span>${escapeHTML(grade)}</span>
            <strong>${gradeStudents.length}</strong>
          </summary>
          <div class="student-class-list"></div>
        </details>
      `);

      const classList = gradeSection.querySelector(".student-class-list");
      const classGroups = groupStudents(gradeStudents, (student) => student.className || "No class");
      [...classGroups.entries()]
        .sort(([classA], [classB]) => compareGroupLabel(classA, classB))
        .forEach(([className, classStudents]) => {
          const classSection = elementFromHTML(`
            <section class="student-class">
              <div class="student-class-header">
                <h3>${escapeHTML(className)}</h3>
                <span>${classStudents.length} student${classStudents.length === 1 ? "" : "s"}</span>
              </div>
              <div class="student-class-rows"></div>
            </section>
          `);

          const rows = classSection.querySelector(".student-class-rows");
          classStudents
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((student) => rows.appendChild(studentCard(student)));
          classList.appendChild(classSection);
        });

      grid.appendChild(gradeSection);
    });
}

function groupStudents(students, getKey) {
  return students.reduce((groups, student) => {
    const key = getKey(student);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(student);
    return groups;
  }, new Map());
}

function compareGroupLabel(a, b) {
  const aNumber = Number(String(a).match(/\d+/)?.[0] || Number.POSITIVE_INFINITY);
  const bNumber = Number(String(b).match(/\d+/)?.[0] || Number.POSITIVE_INFINITY);
  if (aNumber !== bNumber) return aNumber - bNumber;
  return String(a).localeCompare(String(b));
}

function renderStudentOptions() {
  const select = document.getElementById("noteStudent");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">No student selected</option>`;
  [...state.students]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((student) => {
      const option = document.createElement("option");
      option.value = student.id;
      option.textContent = student.name;
      select.appendChild(option);
    });
  select.value = selected;
}

function renderFollowUpOptions() {
  const typeSelect = document.getElementById("noteType");
  const studentSelect = document.getElementById("noteStudent");
  const sourceLabel = document.getElementById("followUpSourceLabel");
  const sourceSelect = document.getElementById("followUpSource");
  if (!typeSelect || !studentSelect || !sourceLabel || !sourceSelect) return;

  const isFollowUp = typeSelect.value === "Follow-up";
  sourceLabel.classList.toggle("hidden", !isFollowUp);
  sourceSelect.required = isFollowUp;
  if (!isFollowUp) {
    sourceSelect.value = "";
    return;
  }

  const selected = sourceSelect.value;
  const studentId = studentSelect.value;
  const sourceNotes = state.notes
    .filter((note) => !studentId || note.studentId === studentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  sourceSelect.innerHTML = `<option value="">Choose previous note</option>`;
  sourceNotes.forEach((note) => {
    const option = document.createElement("option");
    option.value = note.id;
    option.textContent = `${note.type} - ${formatDateTime(note.createdAt)} - ${truncateText(note.text, 52)}`;
    sourceSelect.appendChild(option);
  });
  sourceSelect.value = selected;
}

function renderNotes() {
  const list = document.getElementById("noteList");
  list.innerHTML = "";
  [...state.notes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((note) => {
      const student = getStudentById(note.studentId);
      const sourceNote = getNoteById(note.followUpNoteId);
      list.appendChild(elementFromHTML(`
        <article class="note-card">
          <h3>${escapeHTML(student ? student.name : note.type)}</h3>
          <p>${escapeHTML(note.text)}</p>
          <div class="note-meta">
            <span class="pill">${escapeHTML(note.type)}</span>
            ${note.statusUpdate ? `<span class="pill status-${escapeHTML(note.statusUpdate)}">${escapeHTML(titleCase(note.statusUpdate))}</span>` : ""}
            ${sourceNote ? `<span class="pill">From: ${escapeHTML(sourceNote.type)} ${escapeHTML(formatDateTime(sourceNote.createdAt))}</span>` : ""}
            <span class="pill">${escapeHTML(formatDateTime(note.createdAt))}</span>
          </div>
        </article>
      `));
    });
}

function renderAssistant() {
  const thread = document.getElementById("assistantThread");
  thread.innerHTML = "";
  state.assistant.forEach((message) => {
    thread.appendChild(elementFromHTML(`
      <div class="message ${message.role}">${escapeHTML(message.text)}</div>
    `));
  });
  thread.scrollTop = thread.scrollHeight;
}

function renderCounts() {
  document.getElementById("openCount").textContent = `${openTasks().length} open`;
  document.getElementById("overdueCount").textContent = `${getOverdueTasks().length} overdue`;
}

function taskCard(task) {
  return elementFromHTML(`
    <article class="task-card">
      <strong>${escapeHTML(task.title)}</strong>
      <div class="task-meta">
        <span class="pill">${escapeHTML(task.category)}</span>
        <span class="pill ${task.priority.toLowerCase()}">${escapeHTML(task.priority)}</span>
        <span class="pill ${task.needsDeadline ? "deadline" : ""}">${task.needsDeadline ? "Set deadline" : formatDate(task.due)}</span>
      </div>
    </article>
  `);
}

function studentCard(student) {
  return elementFromHTML(`
    <article class="student-card">
      <div class="student-main">
        <h3><span class="student-status status-${escapeHTML(student.studentStatus || "green")}"></span>${escapeHTML(student.name)}</h3>
        <span>${escapeHTML([student.grade, student.className].filter(Boolean).join(" / ") || "No class details")}</span>
      </div>
      <div class="student-contact">
        <span>${escapeHTML(student.email || "No student email")}</span>
        <span>${escapeHTML([student.parentName, student.parentEmail].filter(Boolean).join(" - ") || "No parent contact")}</span>
      </div>
      <div class="student-action">
        <span>${escapeHTML(student.nextAction || student.goal || "No follow-up yet")}</span>
      </div>
    </article>
  `);
}

async function handleAssistant(text) {
  state.assistant.push({ role: "user", text });
  const lower = text.toLowerCase();

  if (lower.includes("what do i need") || lower.includes("today")) {
    state.assistant.push({ role: "assistant", text: makeDailyAnswer() });
  } else if (lower.startsWith("add task") || lower.includes("remind me to")) {
    const task = parseTask(text);
    state.tasks.push(task);
    state.assistant.push({
      role: "assistant",
      text: `Done. I added "${task.title}" for ${formatDate(task.due)} with ${task.priority.toLowerCase()} priority.`
    });
  } else if (lower.includes("student") || lower.includes("follow up") || lower.includes("follow-up")) {
    const student = findMentionedStudent(text);
    await addNote(text, "Check-in", false, student?.id || "");
    state.assistant.push({
      role: "assistant",
      text: student ? `I saved that note under ${student.name}.` : "I saved that as a student follow-up note. Choose a student in Notes when you want to attach it manually."
    });
  } else if (lower.includes("draft email")) {
    state.assistant.push({
      role: "assistant",
      text: "Subject: Tomorrow's lesson\n\nDear Parents,\n\nI hope you are well. Tomorrow we will continue our learning with a focused lesson and a short applied activity. I will share any required follow-up after class.\n\nKind regards,\nMichael"
    });
  } else {
    await addNote(text, "Other", false);
    state.assistant.push({
      role: "assistant",
      text: "I captured that as a note. Try saying 'add task...' when you want me to create a dated action."
    });
  }

  await saveState();
  renderAll();
}

function makeDailyAnswer() {
  const events = state.schedule.map((event) => `${event.time} ${event.title}`).join("; ");
  const dueToday = sortTasks(openTasks().filter((task) => task.due === isoToday)).map((task) => task.title).join("; ");
  const overdue = getOverdueTasks().map((task) => task.title).join("; ");
  return [
    "Hi Michael.",
    events ? `Today you have: ${events}.` : "You have no calendar events loaded.",
    dueToday ? `Your priority tasks are: ${dueToday}.` : "No tasks are due today.",
    overdue ? `Overdue: ${overdue}.` : "No overdue tasks."
  ].join("\n\n");
}

function parseTask(text) {
  let title = text
    .replace(/add task:?/i, "")
    .replace(/remind me to/i, "")
    .replace(/\bby (today|tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i, "")
    .trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const lower = text.toLowerCase();
  let due = isoToday;
  if (lower.includes("tomorrow")) due = toISODate(tomorrow);
  const weekday = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekday) due = nextWeekdayISO(weekday[1]);

  const priority = lower.includes("urgent") || lower.includes("important") ? "High" : "Medium";
  const category = lower.includes("lesson") ? "Teaching" : lower.includes("university") ? "University" : lower.includes("parent") || lower.includes("student") ? "Counselling" : "Admin";

  return {
    id: crypto.randomUUID(),
    title: title || "New task",
    category,
    priority,
    due,
    status: "Open"
  };
}

async function addNote(text, type = "Check-in", persist = true, studentId = "", statusUpdate = "", followUpNoteId = "") {
  const createdAt = new Date().toISOString();
  state.notes.push({
    id: crypto.randomUUID(),
    studentId,
    followUpNoteId,
    statusUpdate,
    type,
    text,
    createdAt
  });

  if (studentId && statusUpdate) {
    const student = getStudentById(studentId);
    if (student) {
      student.studentStatus = statusUpdate;
      if (statusUpdate === "yellow" || statusUpdate === "red") {
        student.nextAction = student.nextAction || "Follow up required";
        ensureFollowUpTask(student, statusUpdate);
      }
    }
  }

  if (persist) {
    await saveState();
    renderAll();
  }
}

function ensureFollowUpTask(student, statusUpdate) {
  const existing = state.tasks.find((task) => task.studentId === student.id && task.followUpTask && task.status !== "Done");
  const priority = statusUpdate === "red" ? "High" : "Medium";
  const title = `Meet ${student.name} for follow-up`;

  if (existing) {
    existing.title = title;
    existing.category = "Counselling";
    existing.priority = priority;
    existing.needsDeadline = existing.needsDeadline || !existing.due;
    return;
  }

  state.tasks.push({
    id: crypto.randomUUID(),
    title,
    category: "Counselling",
    priority,
    due: isoToday,
    status: "Open",
    studentId: student.id,
    needsDeadline: true,
    followUpTask: true
  });
}

function getStudentById(id) {
  return state.students.find((student) => student.id === id);
}

function getNoteById(id) {
  return state.notes.find((note) => note.id === id);
}

function findMentionedStudent(text) {
  const normalized = normalizeText(text);
  return state.students.find((student) => normalized.includes(normalizeText(student.name)));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .replaceAll("’", "'")
    .replaceAll("`", "'")
    .replace(/\s+/g, " ");
}

async function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.status = task.status === "Done" ? "Open" : "Done";
  await saveState();
  renderAll();
}

function openTasks() {
  return state.tasks.filter((task) => task.status !== "Done");
}

function getOverdueTasks() {
  return openTasks().filter((task) => task.due < isoToday);
}

function getFilteredTasks() {
  const tasks = taskFilter === "done" ? state.tasks.filter((task) => task.status === "Done") : state.tasks;
  if (taskFilter === "today") return sortTasks(tasks.filter((task) => task.due === isoToday && task.status !== "Done"));
  if (taskFilter === "overdue") return sortTasks(getOverdueTasks());
  if (taskFilter === "done") return sortTasks(tasks);
  return sortTasks(tasks);
}

function renderTaskDue(task) {
  if (!task.needsDeadline) return escapeHTML(formatDate(task.due));
  return `<button class="status-button deadline-button" data-deadline-task="${escapeHTML(task.id)}">Set deadline</button>`;
}

function openDeadlineDialog(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  deadlineTaskId = taskId;
  document.getElementById("deadlineTaskTitle").textContent = task.title;
  document.getElementById("deadlineDate").value = task.due || isoToday;
  document.getElementById("deadlineDialog").showModal();
}

function sortTasks(tasks) {
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  return [...tasks].sort((a, b) => a.due.localeCompare(b.due) || priorityRank[a.priority] - priorityRank[b.priority]);
}

function formatDate(value) {
  if (value === isoToday) return "Today";
  if (value === toISODate(tomorrow)) return "Tomorrow";
  return new Date(`${value}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function titleCase(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function nextWeekdayISO(dayName) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const target = days.indexOf(dayName);
  const date = new Date();
  const delta = (target - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return toISODate(date);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function elementFromHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
