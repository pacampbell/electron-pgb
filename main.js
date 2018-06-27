const {app, ipcMain, BrowserWindow, Menu} = require('electron');
const pgb = require('./node_modules/pgb-node/build/Release/pgb.node')

// var bindings = require('bindings');

/*
For c extensions:
npm install -g node-gyp
npm install -g bindings

The C project is in a seperate repository, and do NPM-link:

In the local module directory

$ cd ./package-dir
$ npm link

In the directory of the project to use the module:

$ cd ./project-dir
$ npm link package-name
*/

function show_debug_window()
{
    const win = require('electron').BrowserWindow.getFocusedWindow();
    win.setResizable(true);
    win.setSize(800, 600);
    // win.maximize();
    win.webContents.send('show_debug');
    // win.webContents.openDevTools();
}

function show_standard_window()
{
    const win = require('electron').BrowserWindow.getFocusedWindow();
    win.unmaximize();
    win.setSize(200, 200);
    win.setResizable(false);
    win.webContents.send('show_standard');
}

const menu_template = [
    {
        label: 'File',
        submenu: [
            {role: 'quit'}
        ]
    },
    {
        label: 'Settings',
        submenu : [
            {label: 'Use table decoder'},
            {label: 'Use logical decoder'}
        ]
    },
    {
        label: 'View',
        submenu: [
            {label: 'Standard', click: show_standard_window},
            {label: 'Debug', click: show_debug_window},
            {role: 'reload'},
            {role: 'toggleDevTools'}
        ]
    },
    {
        label: 'Help'
    }
];

function create_window()
{
    const menu = Menu.buildFromTemplate(menu_template);
    let win = new BrowserWindow({width: 200, height: 200, resizable: false, title: "pgb"});
    win.loadFile('app/index.html');

    win.on('closed', () => {
        win = null;
    });

    Menu.setApplicationMenu(menu);

    // Init the emulator device
    pgb.device_init("table");
    pgb.device_load_image("/home/paul/Projects/pgb-lib/roms/dmg_bg_boot_rom.bin");
}

app.on('ready', create_window);


ipcMain.on('pgb-read-registers', (event, args) => {
    const registers = pgb.device_cpu_read_registers();
    event.returnValue = registers;
});

ipcMain.on('pgb-cpu-step', (event, args) => {
    pgb.device_cpu_step();
    event.returnValue = 0;
});

ipcMain.on('pgb-fetch-instructions', (event, args) => {
    const disassembled_instructions = pgb.debugger_disasm(args);
    event.returnValue =  disassembled_instructions;
});

ipcMain.on('pgb-read-region', (event, args) => {
    const memory_contents = pgb.device_mmu_read_region(args.base_address, args.region_size);
    event.returnValue = memory_contents;
});

ipcMain.on('pgb-write-byte', (event, args) => {
    pgb.device_mmu_write_byte(args.address, args.value);
    event.returnValue = 0;
});

ipcMain.on('pgb-reset', (event, args) => {
    pgb.device_reset("table", "/home/paul/Projects/pgb-lib/roms/dmg_bg_boot_rom.bin");
    event.returnValue = 0;
});