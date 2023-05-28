import PocketBase from "./pocketbase.es.mjs";
import ms from "./ms.js";
import config from "./config.js";

const pb = new PocketBase(config.base_url);
const taskList = document.getElementById("tasks");
const completedTasksList = document.getElementById("completedTasks");
let listObj = null;

init();
mainLoop();

// init
async function init() {
  // load a if there is a list being shared to us
  readSharedList();

  const listName = await askForListName();
  const titleContainer = document.getElementById("title");
  titleContainer.getElementsByTagName("h3")[0].innerText =
    titleContainer.getElementsByTagName("h1")[0].innerText;
  titleContainer.getElementsByTagName("h1")[0].innerText = listName;

  //debug
  // console.log(listName);

  loading(true);

  // retrieve saved data
  listObj = await getListFromServer(listName);

  // show "add task" button
  const showAddTaskBtn = document.getElementById("addTaskBtn");
  showAddTaskBtn.style.visibility = "visible";
  showAddTaskBtn.addEventListener("click", () => {
    if (showAddTaskBtn.getAttribute("visible") == "true") {
      showAddTaskBtn.setAttribute("visible", "false");
      document.getElementById("newTask").style.display = "none";
    } else {
      showAddTaskBtn.setAttribute("visible", "true");
      document.getElementById("newTask").style.display = "block";
    }
  });

  // close "add task" button
  const closeAddTaskBtn = document.getElementById("close");
  closeAddTaskBtn.addEventListener("click", () => {
    document.getElementById("newTask").style.display = "none";
    showAddTaskBtn.setAttribute("visible", "false");
  });

  // add task button and form
  const addTaskBtn = document.getElementById("add");
  addTaskBtn.addEventListener("click", async () => {
    const taskForm = document.getElementById("task").value;
    const taskEveryForm = document.getElementById("every").value;
    const taskEveryUnitForm = document.getElementById("everyUnit").value;

    let obj = {
      task: taskForm,
    };

    if (taskEveryForm != "" && taskEveryUnitForm != "") {
      obj.every = taskEveryForm + taskEveryUnitForm;
    }

    listObj.push(await addEntryToServer(listName, obj));

    printTasks(listObj);

    // clear form
    document.getElementById("task").value = "";
    document.getElementById("every").value = "";
  });

  // set "load another list" dropdown button
  const loadAnotherListDropdwn = document.getElementById("recentTasksList");
  loadAnotherListDropdwn.style.visibility = "visible";
  loadAnotherListDropdwn.addEventListener("change", () => {
    const selected = loadAnotherListDropdwn.value.toLocaleLowerCase();
    // reset selection
    var options = document.querySelectorAll("#recentTasksList option");
    for (var i = 0, l = options.length; i < l; i++) {
      options[i].selected = options[i].defaultSelected;
    }

    switch (selected) {
      case "add list":
        localStorage.removeItem("listName");
        window.location.reload();
        break;

      case "remove":
        // TODO
        break;

      default:
        localStorage.setItem("listName", selected.toLocaleLowerCase());
        window.location.reload();
        break;
    }
  });

  // set "load another list" dropdown button options
  let listNamesArray = JSON.parse(localStorage.getItem("listNamesArray")) || [
    "(no more lists added)",
  ];
  listNamesArray.forEach((name) => {
    let option = document.createElement("option");
    option.innerText = name;
    loadAnotherListDropdwn.appendChild(option);
  });

  // show lists
  taskList.style.display = "block";
  completedTasksList.style.display = "block";

  printTasks(listObj);
  loading(false);
}

// main loop
function mainLoop() {
  setTimeout(() => {
    const now = new Date().getTime();

    for (let i = 0; i < completedTasksList.children.length; i++) {
      const element = completedTasksList.children[i];
      const lastTime = element.getAttribute("lastTime");
      const every = element.getAttribute("every");

      if (lastTime == "" || every == "") {
        continue;
      }

      if (+lastTime + ms(every) < now) {
        const checkbox = element.getElementsByTagName("input")[0];
        checkbox.checked = false;
        onTaskChanged(checkbox, element.getAttribute("id"));
      }
    }

    mainLoop();
  }, 1000);
}

// on change event listener
window.onTaskChanged = function (checkbox, listId) {
  const element = document.getElementById(listId);

  if (checkbox.checked == true) {
    element.parentNode.removeChild(element);
    completedTasksList.appendChild(element);
    setLastTime(listId);
  } else if (checkbox.checked == false) {
    element.parentNode.removeChild(element);
    tasks.appendChild(element);
  }

  listObj.find((o) => o.id == listId.split("-")[0]).done = checkbox.checked;
  updateEntry(listObj.find((o) => o.id == listId.split("-")[0]));
};

function setLastTime(listId) {
  const now = new Date().getTime();
  const element = document.getElementById(listId);
  element.setAttribute("lastTime", `${now}`);
  listObj.find((o) => o.id == listId.split("-")[0]).lastTime = now;

  // debug
  // console.log(element);
}

function timeToText(time) {
  // every...
  switch (time) {
    case "12h":
      return "day two times";

    case "24h":
    case "1d":
      return "day";

    case "7d":
    case "1w":
      return "week";

    case "30d":
    case "4w":
    case "1m":
      return "month";

    default:
      return time;
  }
}

async function askForListName() {
  // check if list in localstorage
  let listName = localStorage.getItem("listName");
  if (listName != null) return listName;

  // show modal asking for list name to retrieve/create
  const modal = document.getElementById("askForListName");
  const btn = modal.getElementsByTagName("button")[0];
  const input = modal.getElementsByTagName("input")[0];

  modal.style.display = "block";

  // await for a buton press
  await new Promise((res) => {
    btn.addEventListener("click", res);
  });

  btn.disabled = "disabled";
  input.disabled = "disabled";

  btn.innerText = "loading...";
  listName = input.value.toLocaleLowerCase();

  // save list name to localstorage
  localStorage.setItem("listName", listName);

  // add to the used lists list
  let listNamesArray = JSON.parse(localStorage.getItem("listNamesArray")) || [];
  if (!listNamesArray.includes(listName)) {
    listNamesArray.push(listName);
    localStorage.setItem("listNamesArray", JSON.stringify(listNamesArray));
  }

  // debug
  // localStorage.clear();

  // hide modal
  modal.style.display = "none";

  // return list name
  return listName;
}

async function getListFromServer(listName) {
  syncing(true);

  // retrieve
  const resultList = await pb
    .collection(config.collection_name)
    .getList(1, 200, {
      fields: "id, done, task, every, lastTime, name",
      filter: `name="${listName}"`,
    });

  syncing(false);
  return resultList.items;
}

async function updateEntry(listObj) {
  syncing(true);
  await pb.collection(config.collection_name).update(listObj.id, listObj);
  syncing(false);
}

async function addEntryToServer(listName, listObj) {
  syncing(true);

  listObj.name = listName;

  // update
  const record = await pb.collection(config.collection_name).create(listObj);

  syncing(false);
  return record;
}

function printTasks(listObj) {
  taskList.innerHTML = "";
  completedTasksList.innerHTML = "";

  listObj.forEach((task) => {
    let listEntry = document.createElement("li");
    let input = document.createElement("input");
    let label = document.createElement("label");
    let span = document.createElement("span");

    listEntry.setAttribute("id", `${task.id}-li`);
    listEntry.setAttribute("every", `${task.every}`);
    listEntry.setAttribute("lastTime", `${task.lastTime}`);
    input.setAttribute("id", `${task.id}`);
    input.setAttribute("type", "checkbox");
    if (task.done) {
      input.setAttribute("checked", "checked");
    }
    input.setAttribute("onchange", `onTaskChanged(this, '${task.id}-li')`);
    label.setAttribute("for", `${task.id}`);

    if (task.every != "") {
      span.innerText = ` (every ${timeToText(task.every)})`;
    }

    span.setAttribute("class", "not-important-text");
    label.innerText = task.task;
    label.appendChild(span);
    listEntry.appendChild(input);
    listEntry.appendChild(label);

    if (!task.done) {
      taskList.appendChild(listEntry);
    } else if (task.done) {
      completedTasksList.appendChild(listEntry);
    }
  });
}

function loading(bool) {
  const loading = document.getElementById("loading");
  if (bool) {
    loading.style.display = "block";
  } else {
    loading.style.display = "none";
  }
}

function syncing(bool) {
  const loading = document.getElementById("syncing");
  if (bool) {
    loading.style.display = "block";
  } else {
    loading.style.display = "none";
  }
}

function readSharedList() {
  let pathVar = window.location.pathname;
  if (pathVar != "" && pathVar != "/") {
    pathVar = decodeURI(pathVar);
    pathVar = pathVar.replace("/", "");

    window.location.pathname = "/";

    // set as current list
    localStorage.setItem("listName", pathVar);

    // add to the used lists list
    let listNamesArray = JSON.parse(localStorage.getItem("listNamesArray")) || [];
    if (!listNamesArray.includes(pathVar)) {
      listNamesArray.push(pathVar);
      localStorage.setItem("listNamesArray", JSON.stringify(listNamesArray));
    }
  }
}
