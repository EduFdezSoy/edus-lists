import PocketBase from "./pocketbase.es.mjs";
import ms from "./ms.js";
import config from "./config.js";

const pb = new PocketBase(config.base_url);
const taskList = document.getElementById("tasks");
const completedTasksList = document.getElementById("completedTasks");
let taskListObj = null;

init();
mainLoop();

/**
 * Init function
 * performed only at the app start, will fetch the tasks and present them or ask for a list if needed
 */
async function init() {
  // load a if there is a list being shared to us
  readSharedListAndReload();

  // will return the list name if
  const listName = await askForListName();

  loading(true);

  // set titles
  setTitles(listName);

  // retrieve saved data
  taskListObj = await getListFromServer(listName);

  setupAddTaskButton();
  setupCloseAddTaskFormButton();
  setupAddTaskFormButton(taskListObj);
  setupLoadAnotherListDropdown();

  // show lists
  taskList.style.display = "block";
  completedTasksList.style.display = "block";

  printTasks(taskListObj);
  loading(false);
}

/**
 * Main app loop
 * this loops mainly monitors the tasks to repeat the ones that needs to repeat
 */
function mainLoop() {
  const loopTime = 1000; // execute each second
  setTimeout(() => {
    const now = new Date().getTime();

    for (let i = 0; i < completedTasksList.children.length; i++) {
      const task = completedTasksList.children[i];
      task.lastTime = task.getAttribute("lastTime");
      task.every = task.getAttribute("every");

      // checks if the task is a "one time task"
      if (task.lastTime == "" || task.every == "") {
        continue;
      }

      // if the task will repeat we check if its due to be re-added to the to-do list
      // TODO: change the algorithm here, re-add the tasks at a +10% the repeat time (so a 10h task will repeat at 9h instead)
      if (+task.lastTime + ms(task.every) < now) {
        const checkbox = task.getElementsByTagName("input")[0];
        checkbox.checked = false;
        onTaskChanged(checkbox, task.getAttribute("id"));
      }
    }

    mainLoop();
  }, loopTime);
}

/**
 * event listener for marked or unmarked tasks
 *
 * @param {element} checkbox the literal checkbox DOM element
 * @param {string} listId element id for the list entry
 */
window.onTaskChanged = function (checkbox, listId) {
  const element = document.getElementById(listId);

  // move the element from one list to another (done or not done)
  if (checkbox.checked == true) {
    element.parentNode.removeChild(element);
    completedTasksList.appendChild(element);
    setLastTime(listId);
  } else if (checkbox.checked == false) {
    element.parentNode.removeChild(element);
    tasks.appendChild(element);
  }

  // update the element in the list of tasks and send to server
  taskListObj.find((o) => o.id == listId.split("-")[0]).done = checkbox.checked;
  updateEntry(taskListObj.find((o) => o.id == listId.split("-")[0]));
};

/**
 * sets an attributte "lastTime" to a list element
 * it represents the last time it was marked
 *
 * @param {string} listId element id for the list entry
 */
function setLastTime(listId) {
  const now = new Date().getTime();
  const element = document.getElementById(listId);
  element.setAttribute("lastTime", `${now}`);

  // update the element in the list of tasks
  taskListObj.find((o) => o.id == listId.split("-")[0]).lastTime = now;
}

/**
 * translates from shorts number+letter to text
 * like "2d" to "two days"
 *
 * @param {string} time
 * @returns {string} example: two days
 */
function timeToText(time) {
  // TODO: im sure there is a better way to do this

  // every...
  switch (time) {
    case "12h":
      return "day 2 times";

    case "24h":
    case "1d":
      return "day";

    case "3.5d":
    case "0.5w":
      return "week 2 times";

    case "7d":
    case "1w":
      return "week";

    case "30d":
    case "4w":
      return "month";

    case "1y":
      return "year";

    default:
      switch (time.substring(time.length - 1)) {
        case "d":
          return time.substring(0, time.length - 1) + " days";

        case "w":
          return time.substring(0, time.length - 1) + " weeks";

        case "y":
          return time.substring(0, time.length - 1) + " years";

        default:
          return time;
      }
  }
}

/**
 * Checks if there is a listName saved in the local storage and returns it
 * OR shows the modal to ask the user for it (and returns it when inserted)
 *
 * @returns {string} listName
 */
async function askForListName() {
  // check if list in local storage
  let listName = getCurrentListName();
  if (listName != null) return listName;

  const modal = document.getElementById("askForListName");
  const btn = modal.getElementsByTagName("button")[0];
  const input = modal.getElementsByTagName("input")[0];

  // show modal asking for list name to retrieve/create
  modal.style.display = "block";

  // await for a buton press
  await new Promise((res) => {
    btn.addEventListener("click", res);
  });

  btn.disabled = "disabled";
  input.disabled = "disabled";

  btn.innerText = "loading...";
  listName = input.value.toLocaleLowerCase();

  // save list name to local storage
  setCurrentListName(listName);
  setListNameToTheListsArray(listName);

  // hide modal
  modal.style.display = "none";

  // return list name
  return listName;
}

/**
 * gets the list from the server
 *
 * @param {string} listName
 * @returns the list by the given name
 */
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

/**
 * updates the task in the server
 *
 * @param {object} task tasks in this list
 */
async function updateEntry(task) {
  syncing(true);
  await pb.collection(config.collection_name).update(task.id, task);
  syncing(false);
}

/**
 * adds the task to the server
 *
 * @param {string} listName name of this list
 * @param {object} task tasks in this list
 *
 * @returns the recorded task
 */
async function addEntryToServer(listName, z) {
  syncing(true);

  task.name = listName;

  const record = await pb.collection(config.collection_name).create(task);

  syncing(false);
  return record;
}

/**
 * Prints the tasks in the lists (the to-do one and the done one)
 *
 * @param {object} tasks
 */
function printTasks(tasks) {
  taskList.innerHTML = "";
  completedTasksList.innerHTML = "";

  tasks.forEach((task) => {
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

/**
 * sets a "loading" thingy in the screen so the user knows what's happening
 *
 * @param {boolean} bool
 */
function loading(bool) {
  const loading = document.getElementById("loading");
  if (bool) {
    loading.style.display = "block";
  } else {
    loading.style.display = "none";
  }
}

/**
 * sets a "syncing" thingy in the corner of the screen so the user knows what's happening
 *
 * @param {boolean} bool
 */
function syncing(bool) {
  const loading = document.getElementById("syncing");
  if (bool) {
    loading.style.display = "block";
  } else {
    loading.style.display = "none";
  }
}

/**
 * Will load the shared list if there is one and reload the page to the base path
 */
function readSharedListAndReload() {
  let pathVar = window.location.pathname;
  if (pathVar != "" && pathVar != "/") {
    pathVar = decodeURI(pathVar);
    pathVar = pathVar.replace("/", "");

    setCurrentListName(pathVar);
    setListNameToTheListsArray(pathVar);

    // change the path to the base
    window.location.pathname = "/";
  }
}

/**
 * Sets the header titles
 * moves the app title to a second place and puts the list title
 * it also sets the share link in the title of the list and sets the event
 *
 * @param {string} listName
 */
function setTitles(listName) {
  const titleContainer = document.getElementById("title");
  titleContainer.h3 = titleContainer.getElementsByTagName("h3")[0].innerHTML;
  titleContainer.h1 = titleContainer.getElementsByTagName("h1")[0].innerHTML;

  // set the app title to the h3 top and the title + the copy link button to the h1
  titleContainer.getElementsByTagName("h3")[0].innerHTML = titleContainer.h1;
  titleContainer.getElementsByTagName("h1")[0].innerHTML =
    listName + titleContainer.h3;

  // set the url to this task
  document.getElementById("listLink").addEventListener("click", (event) => {
    event.preventDefault();
    navigator.clipboard.writeText(encodeURI(window.location.href + listName));
    alert("Task link copied to clipboard");
  });
}

/**
 * Adds a name to the lists array
 * the array contains the used lists so the user can change between them easyly
 *
 * @param {string} listName
 */
function setListNameToTheListsArray(listName) {
  // get the array
  let listNamesArray = JSON.parse(localStorage.getItem("listNamesArray")) || [];

  // if the array does not have this name, add the name
  if (!listNamesArray.includes(listName)) {
    listNamesArray.push(listName);
    // save the array
    localStorage.setItem("listNamesArray", JSON.stringify(listNamesArray));
  }
}

/**
 * get the array of lists names
 *
 * @returns {array} string array with the list names
 */
function getListNameFromTheListsArray() {
  return JSON.parse(localStorage.getItem("listNamesArray")) || [];
}

/**
 * sets the current list name to the local storage
 *
 * @param {string} listName
 */
function setCurrentListName(listName) {
  localStorage.setItem("listName", listName);
}

/**
 * returns the current list name from the local storage
 *
 * @returns {string | null} the current list name
 */
function getCurrentListName() {
  return localStorage.getItem("listName");
}

/**
 * removes the current list name from the local storage
 */
function removeCurrentListName() {
  localStorage.removeItem("listName");
}

/**
 * Makes the add task button in the header visible and sets the
 * click event to show/hide the add task modal form
 */
function setupAddTaskButton() {
  const showAddTaskBtn = document.getElementById("addTaskBtn");
  const newTaskForm = document.getElementById("newTask");

  showAddTaskBtn.addEventListener("click", () => {
    if (showAddTaskBtn.getAttribute("visible") == "true") {
      showAddTaskBtn.setAttribute("visible", "false");
      newTaskForm.style.display = "none";
    } else {
      showAddTaskBtn.setAttribute("visible", "true");
      newTaskForm.style.display = "block";
    }
  });

  showAddTaskBtn.style.visibility = "visible";
}

/**
 * Adds the right event to the close button inside the add task modal form
 */
function setupCloseAddTaskFormButton() {
  const showAddTaskBtn = document.getElementById("addTaskBtn");
  const closeAddTaskBtn = document.getElementById("close");
  const newTaskForm = document.getElementById("newTask");

  closeAddTaskBtn.addEventListener("click", () => {
    newTaskForm.style.display = "none";
    showAddTaskBtn.setAttribute("visible", "false");
  });
}

/**
 * Adds the click event to the add task button inside the add task modal form
 * it adds a new task when clicked
 *
 * @param {object} taskList the array of task objects
 */
function setupAddTaskFormButton(taskList) {
  const addTaskBtn = document.getElementById("add");

  // when a new task is added... (button clicked)
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

    taskList.push(await addEntryToServer(listName, obj));

    printTasks(taskList);

    // clear the form
    document.getElementById("task").value = "";
    document.getElementById("every").value = "";
  });
}

/**
 * adds the event to manage list changes and to add/remove new lists
 * then it shows the dropdown element
 */
function setupLoadAnotherListDropdown() {
  // set "load another list" dropdown button
  const loadAnotherListDropdwn = document.getElementById("recentTasksList");

  loadAnotherListDropdwn.addEventListener("change", () => {
    const selected = loadAnotherListDropdwn.value.toLocaleLowerCase();

    // reset selection to always show "load another list"
    var options = document.querySelectorAll("#recentTasksList option");
    for (var i = 0, l = options.length; i < l; i++) {
      options[i].selected = options[i].defaultSelected;
    }

    // do something with the selection
    switch (selected) {
      // opens the modal form to add a list name (clears the current and reloads the page)
      case "add list":
        removeCurrentListName();
        window.location.reload();
        break;

      // removes the current list name from the list (may add another and reload)
      case "remove":
        // TODO: the remove list from the dropdown
        break;

      // when an item is selected we set it as the current active list name and reload the page
      default:
        setCurrentListName(selected.toLocaleLowerCase());
        window.location.reload();
        break;
    }
  });

  // set "load another list" dropdown button options
  let listNamesArray = getListNameFromTheListsArray();

  listNamesArray.forEach((name) => {
    let option = document.createElement("option");
    option.innerText = name;
    loadAnotherListDropdwn.appendChild(option);
  });

  // make it visible
  loadAnotherListDropdwn.style.visibility = "visible";
}
