import PocketBase from "./pocketbase.es.mjs";
import ms from "./ms.js";
import config from "./config.js";
import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.module.mjs";

const pb = new PocketBase(config.base_url);
const taskList = document.getElementById("tasks");
const completedTasksList = document.getElementById("completedTasks");
const mousePos = { x: null, y: null };
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
  setupAddTaskFormButton(taskListObj, listName);

  // show lists
  taskList.style.display = "block";
  completedTasksList.style.display = "block";

  // setup mouse poss event
  window.onmousemove = (e) => {
    mousePos.x = e.clientX;
    mousePos.y = e.clientY;
  };

  printTasks(taskListObj);
  setupLoadAnotherListDropdown();

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
    if (element.parentNode.childElementCount == 1) {
      fireConfetti();
    }

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
 * event listener for when hovering a task
 *
 * @param {bool} isHover
 * @param {string} taskId
 */
window.onTaskHovered = function (isHover, taskId) {
  const listEntry = document.getElementById(taskId + "-li");
  const icons = listEntry.getElementsByTagName("svg");

  if (isHover) {
    for (let i = 0; i < icons.length; i++) {
      setSVGVisible(true, icons[i]);
    }
  } else {
    for (let i = 0; i < icons.length; i++) {
      setSVGVisible(false, icons[i]);
    }
  }
};

/**
 * makes an svg visible with a given color
 *
 * @param {boolean} makeVisible
 * @param {SVGElement} element
 * @param {string} color not required if @makeVisible set to true
 */
window.setSVGVisible = function (makeVisible, element, color = null) {
  if (makeVisible) {
    element.style.visibility = "visible";
    element.getElementsByTagName("path")[0].style.fill = color;
  } else {
    setTimeout(() => {
      element.style.visibility = "";
      element.getElementsByTagName("path")[0].style.fill = "";
    }, 100);
  }
};

/**
 * Removes a task from the list AND the server
 * 
 * @param {string} taskId 
 */
window.removeTaskOnSVGClick = function (taskId) {
  // search task in list and remove
  taskListObj = taskListObj.filter(el => el.id !== taskId);

  removeEntryFromServer(taskId);
  printTasks(taskListObj);
}

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
async function addEntryToServer(listName, task) {
  syncing(true);

  task.name = listName;

  const record = await pb.collection(config.collection_name).create(task);

  syncing(false);
  return record;
}

/**
 * removes a task from the server
 * 
 * @param {string} taskId 
 */
async function removeEntryFromServer(taskId) {
  syncing(true);
  await pb.collection(config.collection_name).delete(taskId);
  syncing(false);
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
    // create elements we need
    let listEntry = document.createElement("li");
    let input = document.createElement("input");
    let label = document.createElement("label");
    let span = document.createElement("span");
    let deleteSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    // form a task entry
    listEntry.setAttribute("id", `${task.id}-li`);
    listEntry.setAttribute("every", `${task.every}`);
    listEntry.setAttribute("lastTime", `${task.lastTime}`);

    input.setAttribute("id", `${task.id}`);
    input.setAttribute("type", "checkbox");
    if (task.done) {
      input.setAttribute("checked", "checked");
    }
    label.setAttribute("for", `${task.id}`);

    if (task.every != "") {
      span.innerText = ` (every ${timeToText(task.every)})`;
    }

    // set delete icon
    deleteSvg.innerHTML =
      '<title>delete task</title><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />';
    deleteSvg.setAttribute("viewBox", "0 0 24 24");
    deleteSvg.setAttribute("class", "icon");
    deleteSvg.setAttribute("name", "delete");

    // events
    input.setAttribute("onchange", `onTaskChanged(this, '${task.id}-li')`);
    label.setAttribute("onmouseenter", `onTaskHovered(true, '${task.id}')`);
    listEntry.setAttribute("onmouseleave", `onTaskHovered(false, '${task.id}')`);
    deleteSvg.setAttribute("onmouseenter", "setSVGVisible(true, this, 'red')");
    deleteSvg.setAttribute("onmouseleave", "setSVGVisible(false, this)");
    deleteSvg.setAttribute("onclick", `removeTaskOnSVGClick('${task.id}')`)

    // form the final element
    span.setAttribute("class", "not-important-text");
    label.innerText = task.task;
    label.appendChild(span);
    listEntry.appendChild(input);
    listEntry.appendChild(label);
    listEntry.appendChild(deleteSvg);

    // add to list
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
  const listUrl = encodeURI(window.location.href + listName);
  const titleContainer = document.getElementById("title");
  titleContainer.h3 = titleContainer.getElementsByTagName("h3")[0].innerHTML;
  titleContainer.h1 = titleContainer.getElementsByTagName("h1")[0].innerHTML;

  // set the app title to the h3 top and the title + the copy link button to the h1
  titleContainer.getElementsByTagName("h3")[0].innerHTML = titleContainer.h1;
  const h1Content = document.createElement("span");
  h1Content.innerHTML = listName + titleContainer.h3;
  titleContainer.getElementsByTagName("h1")[0].innerHTML = h1Content.outerHTML;

  // set pointer to title
  titleContainer.getElementsByTagName("h1")[0].classList.add("pointer");

  // on hover iluminate the link icon
  titleContainer.querySelector("h1 span").addEventListener("mouseover", () => {
    titleContainer.querySelector("#title .icon").style.opacity = 1;
  });
  // and when the mouse leaves...
  titleContainer.querySelector("h1 span").addEventListener("mouseout", () => {
    titleContainer.querySelector("#title .icon").style.opacity = 0.3;
  });

  // set the url to the title
  titleContainer.querySelector("h1 span").addEventListener("click", () => {
    navigator.clipboard.writeText(listUrl);
    // TODO: change this alert with some nice css
    alert("Task link copied to clipboard");
  });

  // set the list url to the href so the user can see the path on hover
  titleContainer.getElementsByTagName("a")[0].setAttribute("href", listUrl);

  // prevent a from redirecting
  document.getElementById("listLink").addEventListener("click", (event) => {
    event.preventDefault();
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
 * Removes a name from the list array in the local storage
 * the array constains the used lists so the user can change betweeb them easyly
 *
 * @param {string} listName
 */
function removeListNameFromTheListsArray(listName) {
  let list = JSON.parse(localStorage.getItem("listNamesArray")) || [];
  const index = list.indexOf(listName);
  if (index > -1) list.splice(index, 1);
  localStorage.setItem("listNamesArray", JSON.stringify(list));
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
function setupAddTaskFormButton(taskList, listName) {
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

      // removes the current list name from the list, sets another and reload the page
      case "remove this list":
        removeListNameFromTheListsArray(getCurrentListName());
        setCurrentListName(getListNameFromTheListsArray()[0]);
        window.location.reload();
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

/**
 * Fires confetti in the given coordinates
 *
 * @param {number} x horizontal screen position
 * @param {number} y vertical screen position
 */
async function fireConfetti() {
  let defaults = {
    origin: {
      x: mousePos.x / window.innerWidth,
      y: mousePos.y / window.innerHeight,
    },
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    shapes: ["star"],
    colors: ["FFE400", "FFBD00", "E89400", "FFCA6C", "FDFFB8"],
  };

  let stars = {
    ...defaults,
    particleCount: 20,
    scalar: 1.2,
    shapes: ["star"],
  };

  let normalConfetti = {
    ...defaults,
    particleCount: 50,
    scalar: 0.75,
    shapes: ["square"],
    colors: [
      "cdb4db",
      "ffc8dd",
      "ffafcc",
      "bde0fe",
      "a2d2ff",
      "FEEA00",
      "6A66A3",
      "EB5E28",
    ],
  };

  confetti(stars);

  setTimeout(() => {
    confetti(normalConfetti);
  }, 100);
  setTimeout(() => {
    confetti(stars);
  }, 200);
  setTimeout(() => {
    confetti(normalConfetti);
  }, 300);
  setTimeout(() => {
    confetti(stars);
  }, 400);
}
