const STORAGE_KEY = "school-secretary-ai-mvp";
const SUPABASE_SCRIPT = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const GOOGLE_API_SCRIPT = "https://apis.google.com/js/api.js";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const today = new Date();
const isoToday = toISODate(today);
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);

const seedData = {
  tasks: [
    { id: crypto.randomUUID(), title: "Finish university acceptance spreadsheet", category: "Admin", priority: "High", due: isoToday, status: "Open" },
    { id: crypto.randomUUID(), title: "Email University of Leeds representative", category: "University", priority: "High", due: isoToday, status: "Open" },
    { id: crypto.randomUUID(), title: "Prepare tomorrow's lesson on Human Development", category: "Teaching", priority: "Medium", due: toISODate(tomorrow), status: "Open" },
    { id: crypto.randomUUID(), title: "Update CIALFO documents", category: "Counselling", priority: "High", due: toISODate(yesterday), status: "Open" },
    { id: crypto.randomUUID(), title: "Submit internship proposal", category: "Admin", priority: "Medium", due: toISODate(yesterday), status: "Open" },
    { id: crypto.randomUUID(), title: "Finish CAT4 report", category: "Admin", priority: "High", due: toISODate(yesterday), status: "Open" }
  ],
  schedule: [
    { id: crypto.randomUUID(), time: "08:00", title: "DP Psychology Year 1", location: "Room 204" },
    { id: crypto.randomUUID(), time: "10:00", title: "Student university check-in", location: "Counselling Office" },
    { id: crypto.randomUUID(), time: "14:00", title: "Meet parent of Student A", location: "Conference Room" },
    { id: crypto.randomUUID(), time: "15:30", title: "Admin block", location: "Desk" }
  ],
  students: [
    { id: crypto.randomUUID(), name: "Student A", goal: "Mechanical Engineering in Australia", nextAction: "Send shortlist of Australian universities", deadline: isoToday, notes: "Parent meeting at 2 PM. Interested in practical engineering programs." },
    { id: crypto.randomUUID(), name: "Student B", goal: "Medicine in the UK", nextAction: "Check IELTS and predicted grade requirements", deadline: toISODate(tomorrow), notes: "Needs early UCAS planning and interview preparation." },
    { id: crypto.randomUUID(), name: "Student C", goal: "Gap year before university", nextAction: "Discuss structured volunteering options", deadline: toISODate(addDays(today, 3)), notes: "Family wants a plan with clear learning outcomes." }
  ],
  notes: [
    { id: crypto.randomUUID(), type: "Meeting", text: "Student A wants Mechanical Engineering in Australia. Next step: send a shortlist and check application deadlines.", createdAt: new Date().toISOString() }
  ],
  assistant: [
    { role: "assistant", text: "Hi Michael. Ask me what you need to do today, or tell me to add a task, student follow-up, or note." }
  ]
};

let state = loadState();
let taskFilter = "all";
let supabaseClient = null;
let currentUser = null;
let cloudReady = false;
let syncing = false;
let googleTokenClient = null;
let googleConfigured = false;
let googleReady = false;
let googleConnected = false;

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
    currentUser = data.session?.user || null;
    cloudReady = Boolean(currentUser);

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user || null;
      cloudReady = Boolean(currentUser);
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
      discoveryDocs: [GOOGLE_DISCOVERY_DOC]
    });

    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.GOOGLE_CLIENT_ID,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: ""
    });

    googleReady = true;
    renderCalendarState();
  } catch (error) {
    googleReady = false;
    googleConnected = false;
    renderCalendarState("Calendar unavailable");
    console.warn(error);
  }
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
    connectButton.classList.add("hidden");
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleConfigured) {
    stateLabel.textContent = "Setup needed";
    stateLabel.classList.add("needs-setup");
    connectButton.classList.add("hidden");
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleReady) {
    stateLabel.textContent = "Loading";
    connectButton.classList.add("hidden");
    refreshButton.classList.add("hidden");
    return;
  }

  if (!googleConnected) {
    stateLabel.textContent = "Not connected";
    stateLabel.classList.add("needs-setup");
    connectButton.classList.remove("hidden");
    refreshButton.classList.add("hidden");
    return;
  }

  stateLabel.textContent = "Google";
  stateLabel.classList.add("connected");
  connectButton.classList.add("hidden");
  refreshButton.classList.remove("hidden");
}

async function connectGoogleCalendar() {
  if (!googleReady || !googleTokenClient) return;

  googleTokenClient.callback = async (response) => {
    if (response.error) {
      renderCalendarState("Calendar error");
      return;
    }
    googleConnected = true;
    renderCalendarState();
    await loadTodayCalendarEvents();
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
    renderCalendarState("Calendar error");
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
    status: row.status
  };
}

function toCloudStudent(student) {
  return {
    id: student.id,
    owner_id: currentUser.id,
    display_name: student.name,
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
    note_type: note.type,
    body: note.text,
    created_at: note.createdAt
  };
}

function fromCloudNote(row) {
  return {
    id: row.id,
    type: row.note_type,
    text: row.body,
    createdAt: row.created_at
  };
}

function renderAll() {
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
  const studentDialog = document.getElementById("studentDialog");
  const authDialog = document.getElementById("authDialog");

  document.getElementById("quickAddTask").addEventListener("click", openTaskDialog);
  document.getElementById("addTaskFromTasks").addEventListener("click", openTaskDialog);
  document.getElementById("signInButton").addEventListener("click", () => authDialog.showModal());
  document.getElementById("signOutButton").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
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

  document.getElementById("taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.tasks.push({
      id: crypto.randomUUID(),
      title: document.getElementById("taskTitle").value.trim(),
      category: document.getElementById("taskCategory").value,
      priority: document.getElementById("taskPriority").value,
      due: document.getElementById("taskDue").value,
      status: "Open"
    });
    event.target.reset();
    await saveState();
    taskDialog.close();
    renderAll();
  });

  document.getElementById("studentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.students.push({
      id: crypto.randomUUID(),
      name: document.getElementById("studentName").value.trim(),
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
    if (!text) return;
    await addNote(text, document.getElementById("noteType").value);
    event.target.reset();
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
  document.getElementById("connectCalendar").addEventListener("click", connectGoogleCalendar);
  document.getElementById("refreshCalendar").addEventListener("click", loadTodayCalendarEvents);
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
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3)
    .forEach((student) => list.appendChild(studentCard(student)));
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
        <td>${formatDate(task.due)}</td>
        <td><button class="status-button ${task.status === "Done" ? "done" : ""}" data-task="${task.id}">${escapeHTML(task.status)}</button></td>
      </tr>
    `);
    row.querySelector("button").addEventListener("click", () => toggleTask(task.id));
    table.appendChild(row);
  });
}

function renderStudents() {
  const query = document.getElementById("studentSearch").value.trim().toLowerCase();
  const grid = document.getElementById("studentGrid");
  grid.innerHTML = "";
  state.students
    .filter((student) => [student.name, student.goal, student.nextAction, student.notes].join(" ").toLowerCase().includes(query))
    .forEach((student) => grid.appendChild(studentCard(student)));
}

function renderNotes() {
  const list = document.getElementById("noteList");
  list.innerHTML = "";
  [...state.notes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((note) => {
      list.appendChild(elementFromHTML(`
        <article class="note-card">
          <h3>${escapeHTML(note.type)}</h3>
          <p>${escapeHTML(note.text)}</p>
          <div class="note-meta">
            <span class="pill">${new Date(note.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
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
        <span class="pill">${formatDate(task.due)}</span>
      </div>
    </article>
  `);
}

function studentCard(student) {
  return elementFromHTML(`
    <article class="student-card">
      <h3>${escapeHTML(student.name)}</h3>
      <p>${escapeHTML(student.goal)}</p>
      <div class="student-meta">
        <span class="pill">${escapeHTML(student.nextAction)}</span>
        <span class="pill">${formatDate(student.deadline)}</span>
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
    await addNote(text, "Meeting", false);
    state.assistant.push({
      role: "assistant",
      text: "I saved that as a student follow-up note. In the connected version, I would also attach it to the matching student record automatically."
    });
  } else if (lower.includes("draft email")) {
    state.assistant.push({
      role: "assistant",
      text: "Subject: Tomorrow's lesson\n\nDear Parents,\n\nI hope you are well. Tomorrow we will continue our learning with a focused lesson and a short applied activity. I will share any required follow-up after class.\n\nKind regards,\nMichael"
    });
  } else {
    await addNote(text, "Admin", false);
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

async function addNote(text, type = "Meeting", persist = true) {
  state.notes.push({
    id: crypto.randomUUID(),
    type,
    text,
    createdAt: new Date().toISOString()
  });
  if (persist) {
    await saveState();
    renderAll();
  }
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

function sortTasks(tasks) {
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  return [...tasks].sort((a, b) => a.due.localeCompare(b.due) || priorityRank[a.priority] - priorityRank[b.priority]);
}

function formatDate(value) {
  if (value === isoToday) return "Today";
  if (value === toISODate(tomorrow)) return "Tomorrow";
  return new Date(`${value}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
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
