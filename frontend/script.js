const API_BASE_URL = "/api";
const USER_KEY = "momentum-user";

let tasksData = {
  todo: [],
  progress: [],
  done: [],
  trash: []
};
let draggedTaskId = null;
let editingTask = null;
let lastDeletedTaskId = null;
let toastTimer = null;

const columns = document.querySelectorAll(".task-col");
const taskLists = document.querySelectorAll(".task-list");

const modal = document.querySelector(".add-new-task");
const modalBg = document.querySelector(".modal-bg");
const modalTitle = document.querySelector("#modal-title");
const taskForm = document.querySelector("#task-form");
const toggleModalButton = document.querySelector("#toggle-modal");
const submitTaskButton = document.querySelector("#add-new-task");
const taskTitleInput = document.querySelector("#task-title-input");
const taskDescInput = document.querySelector("#task-desc-input");

const trashModal = document.querySelector(".trash-modal");
const openTrashButton = document.querySelector("#open-trash");
const closeTrashButton = document.querySelector("#close-trash");
const trashBg = document.querySelector(".trash-bg");
const trashList = document.querySelector("#trash-list");
const trashCount = document.querySelector("#trash-count");

const toast = document.querySelector("#toast");
const undoDeleteButton = document.querySelector("#undo-delete");

const loginModal = document.querySelector(".login-modal");
const loginForm = document.querySelector("#login-form");
const loginNameInput = document.querySelector("#login-name");
const loginEmailInput = document.querySelector("#login-email");
const welcomeUser = document.querySelector("#welcome-user");
const logoutButton = document.querySelector("#logout-btn");

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function loadTasks() {
  tasksData = await request("/tasks");
  renderTasks();
}

function loadUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function saveUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function updateUserUI() {
  const user = loadUser();

  if (!user) {
    welcomeUser.textContent = "Welcome";
    loginModal.classList.add("active");
    setTimeout(() => loginNameInput.focus(), 0);
    return;
  }

  welcomeUser.textContent = `Welcome, ${user.name}`;
  loginModal.classList.remove("active");
}

function logoutUser() {
  localStorage.removeItem(USER_KEY);
  loginForm.reset();
  updateUserUI();
}

function createTaskElement(task) {
  const taskCard = document.createElement("div");
  taskCard.classList.add("task");
  taskCard.setAttribute("draggable", "true");
  taskCard.dataset.id = task.id;

  const title = document.createElement("h2");
  title.textContent = task.title;

  const desc = document.createElement("p");
  desc.textContent = task.desc || "No description added.";

  const actions = document.createElement("div");
  actions.classList.add("task-actions");

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.classList.add("edit-btn");
  editButton.textContent = "Edit";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.classList.add("delete-btn");
  deleteButton.textContent = "Delete";

  actions.append(editButton, deleteButton);
  taskCard.append(title, desc, actions);

  taskCard.addEventListener("dragstart", () => {
    draggedTaskId = task.id;
    taskCard.classList.add("dragging");
  });

  taskCard.addEventListener("dragend", () => {
    draggedTaskId = null;
    taskCard.classList.remove("dragging");
  });

  editButton.addEventListener("click", () => {
    openTaskModal(task);
  });

  deleteButton.addEventListener("click", async () => {
    await moveTaskToTrash(task.id);
  });

  return taskCard;
}

function renderTasks() {
  taskLists.forEach((list) => {
    list.textContent = "";
  });

  ["todo", "progress", "done"].forEach((status) => {
    const list = document.querySelector(`#${status}-list`);

    tasksData[status].forEach((task) => {
      list.appendChild(createTaskElement(task));
    });

    updateCount(status);
  });

  trashCount.textContent = tasksData.trash.length;
  renderTrash();
}

function updateCount(status) {
  const count = document.querySelector(`#${status}-count`);
  count.textContent = tasksData[status].length;
}

async function addTask(title, desc) {
  await request("/tasks", {
    method: "POST",
    body: JSON.stringify({ title, desc })
  });

  await loadTasks();
}

async function updateTask(id, title, desc) {
  await request(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title, desc })
  });

  await loadTasks();
}

async function moveTaskToTrash(id) {
  await request(`/tasks/${id}`, {
    method: "DELETE"
  });

  lastDeletedTaskId = id;
  await loadTasks();
  showUndoToast();
}

async function restoreTask(id) {
  await request(`/tasks/${id}/restore`, {
    method: "POST"
  });

  await loadTasks();
}

async function deleteForever(id) {
  await request(`/tasks/${id}/forever`, {
    method: "DELETE"
  });

  await loadTasks();
}

async function moveTaskToColumn(taskId, newStatus, orderedIds) {
  tasksData = await request(`/tasks/${taskId}/move`, {
    method: "PATCH",
    body: JSON.stringify({
      status: newStatus,
      orderedIds
    })
  });

  renderTasks();
}

function getDragAfterElement(list, y) {
  const draggableElements = [...list.querySelectorAll(".task:not(.dragging)")];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return {
          offset,
          element: child
        };
      }

      return closest;
    },
    {
      offset: Number.NEGATIVE_INFINITY,
      element: null
    }
  ).element;
}

function openTaskModal(task = null) {
  editingTask = task;

  modal.classList.add("active");
  modalTitle.textContent = task ? "Edit Task" : "Add Task";
  submitTaskButton.textContent = task ? "Save Changes" : "Add New Task";

  taskTitleInput.value = task ? task.title : "";
  taskDescInput.value = task ? task.desc : "";

  setTimeout(() => taskTitleInput.focus(), 0);
}

function closeTaskModal() {
  modal.classList.remove("active");
  taskForm.reset();
  editingTask = null;
  toggleModalButton.focus();
}

function openTrashModal() {
  trashModal.classList.add("active");
}

function closeTrashModal() {
  trashModal.classList.remove("active");
  openTrashButton.focus();
}

function renderTrash() {
  trashList.textContent = "";

  tasksData.trash.forEach((task) => {
    const item = document.createElement("div");
    item.classList.add("trash-item");

    const title = document.createElement("h3");
    title.textContent = task.title;

    const desc = document.createElement("p");
    desc.textContent = task.desc || "No description added.";

    const actions = document.createElement("div");
    actions.classList.add("trash-actions");

    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.classList.add("restore-btn");
    restoreButton.textContent = "Restore";

    const foreverButton = document.createElement("button");
    foreverButton.type = "button";
    foreverButton.classList.add("forever-btn");
    foreverButton.textContent = "Delete Forever";

    restoreButton.addEventListener("click", async () => {
      await restoreTask(task.id);
    });

    foreverButton.addEventListener("click", async () => {
      await deleteForever(task.id);
    });

    actions.append(restoreButton, foreverButton);
    item.append(title, desc, actions);
    trashList.appendChild(item);
  });
}

function showUndoToast() {
  clearTimeout(toastTimer);
  toast.classList.add("active");

  toastTimer = setTimeout(() => {
    toast.classList.remove("active");
    lastDeletedTaskId = null;
  }, 5000);
}

columns.forEach((column) => {
  const list = column.querySelector(".task-list");
  const status = column.dataset.status;

  column.addEventListener("dragenter", (event) => {
    event.preventDefault();
    column.classList.add("hover-over");
  });

  column.addEventListener("dragleave", () => {
    column.classList.remove("hover-over");
  });

  column.addEventListener("dragover", (event) => {
    event.preventDefault();

    const afterElement = getDragAfterElement(list, event.clientY);
    const draggingElement = document.querySelector(".dragging");

    if (!draggingElement) {
      return;
    }

    if (afterElement) {
      list.insertBefore(draggingElement, afterElement);
    } else {
      list.appendChild(draggingElement);
    }
  });

  column.addEventListener("drop", async (event) => {
    event.preventDefault();
    column.classList.remove("hover-over");

    if (!draggedTaskId) {
      return;
    }

    const orderedIds = [...list.querySelectorAll(".task")].map((task) => task.dataset.id);
    await moveTaskToColumn(draggedTaskId, status, orderedIds);
  });
});

toggleModalButton.addEventListener("click", () => {
  openTaskModal();
});

modalBg.addEventListener("click", closeTaskModal);

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = taskTitleInput.value.trim();
  const desc = taskDescInput.value.trim();

  if (!title) {
    taskTitleInput.focus();
    return;
  }

  if (editingTask) {
    await updateTask(editingTask.id, title, desc);
  } else {
    await addTask(title, desc);
  }

  closeTaskModal();
});

openTrashButton.addEventListener("click", openTrashModal);
closeTrashButton.addEventListener("click", closeTrashModal);
trashBg.addEventListener("click", closeTrashModal);

undoDeleteButton.addEventListener("click", async () => {
  if (!lastDeletedTaskId) {
    return;
  }

  await restoreTask(lastDeletedTaskId);
  lastDeletedTaskId = null;
  toast.classList.remove("active");
  clearTimeout(toastTimer);
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = loginNameInput.value.trim();
  const email = loginEmailInput.value.trim();

  if (!name) {
    loginNameInput.focus();
    return;
  }

  if (!email) {
    loginEmailInput.focus();
    return;
  }

  saveUser({
    name,
    email,
    loggedInAt: Date.now()
  });

  updateUserUI();
});

logoutButton.addEventListener("click", logoutUser);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (modal.classList.contains("active")) {
    closeTaskModal();
  }

  if (trashModal.classList.contains("active")) {
    closeTrashModal();
  }
});

loadTasks().catch((error) => {
  console.error(error);
  alert("Could not connect to the Momentum API.");
});
updateUserUI();


//updating//