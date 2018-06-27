'use strict';
const ipc = require('electron').ipcRenderer;
const {remote} = require('electron');
const util = require('util')
const printf = require('printf');
const format = require('string-format')

let application_window = document.defaultView;
format.extend(String.prototype, {});

const debugger_help_text =`
<span class="debugger green">pgb debugger</span> - Interactive tool for debugging GB applications.

<span class="debugger white">Commands:</span>
    <span class="debugger white">break address</span>
        Sets a breakpoint at the given <span class="debugger blue">address</span>.
    <span class="debugger white">continue</span>
        If the application is currently stopped at a breakpoint, it will resume.
    <span class="debugger white">help</span>
        Displays this help menu.
    <span class="debugger white">history [clear]</span>
        Displays the history of all previously typed commands. Accepts the optional argument 'clear' to remove all history.
    <span class="debugger white">quit</span>
        Quits the application.
    <span class="debugger white">read $reg|address</span>
        Reads the 8-bit value stored in the given register or address.
    <span class="debugger white">reset</span>
        Removes all text in the output window.
    <span class="debugger white">step n</span>
        Steps the currently loaded program <span class="debugger blue">n</span> instructions. If the value <span class="debugger blue">n</span> is not provided, 1 instruction will be stepped.
    <span class="debugger white">write $reg|address value</span>
        Sets an 8-bit value in the given register or address.
`;

let debugger_state = {
    previous_command: null,
    history: [],
    prev_history_index: 0,
    history_index: 0,
    input_buffer: "",
    breakpoints: []
};

function debugger_write_output(string, color=null, ln=false)
{
    let output_window = $("#debugger-output pre");

    if (color === null) {
        output_window.append(string);
    } else {
        let span = $('<span>').addClass(util.format('debugger %s', color));
        span.text(string);
        output_window.append(span);
    }

    if (ln) {
        let br = $('<br>');
        output_window.append(br);
    }
}

function debugger_gadget_break(args)
{
    let address;

    if (args.length < 2) {
        debugger_write_output('Error: ', 'red');
        debugger_write_output(util.format('Expected two arguments but got %d',
                                           args.length));
        return;
    }

    address = parseInt(args[1], 0);
    if (debugger_state.breakpoints.indexOf(address) == -1) {
        debugger_state.breakpoints.push(address);
        debugger_write_output('Breakpoint set at address ');
        debugger_write_output(util.format("0x%s", ("0000" + address.toString(16)).substr(-4)), 'orange');
        debugger_write_output('.');
    } else {
        debugger_write_output('Warning: ', 'orange');
        debugger_write_output(util.format('Breakpoint already exists at address %s', ("0000" + address.toString(16)).substr(-4)));
    }
}

function debugger_gadget_continue(args)
{
    let registers, pc, addr_str, decoded_position;

    while (true) {
        ipc.sendSync('pgb-cpu-step');
        registers = ipc.sendSync('pgb-read-registers');

        pc = registers['pc'];
        if (debugger_state.breakpoints.indexOf(pc) != -1) {
            addr_str = util.format("0x%s", ("0000" + pc.toString(16)).substr(-4));
            debugger_write_output('Info: ', 'blue');
            debugger_write_output('Breakpoint at address ');
            debugger_write_output(util.format('%s', addr_str), 'orange');
            debugger_write_output(' hit.', null, true);
            break;
        }
    }

    update_register_display();
    update_debugger_disasm();

    decoded_position = ipc.sendSync('pgb-fetch-instructions', 1);
    debugger_write_output(util.format("$PC = %s, %s", addr_str, JSON.stringify(decoded_position)));
}

function debugger_gadget_help(args)
{
    let output_window = document.querySelector("#debugger-output pre");
    output_window.innerHTML += debugger_help_text;
}

function debugger_gadget_history(args)
{
    if (args.length == 2 && args[1] === 'clear') {
        debugger_state.history = [];
    }

    if (debugger_state.history.length == 0) {
        return;
    }

    for (let i = 0; i < debugger_state.history.length; i++) {
        debugger_write_output(util.format('%d ', i), 'orange');
        debugger_write_output(debugger_state.history[i], null, true);
    }
}

function debugger_gadget_quit(args)
{
    let win = remote.getCurrentWindow();
    win.close();
}

function debugger_gadget_dump_memory_row(memory_contents, base_address,
                                        base_index, size)
{
    let i, byte_value, char, ascii_data;
    let address = util.format("%s ", ("0000" + base_address.toString(16)).substr(-4));

    debugger_write_output(address);
    for (i = 0; i < size; i++) {
        byte_value = util.format("%s ", ("00" + memory_contents[base_index + i].toString(16)).substr(-2));
        debugger_write_output(byte_value);
    }

    for (; i < 16; i++) {
        debugger_write_output('   ');
    }

    ascii_data = '';
    for (i = 0; i < size; i++) {
        byte_value = memory_contents[base_address + i];

        if (byte_value >= ' '.charCodeAt(0) && byte_value <= '~'.charCodeAt(0)) {
            char = String.fromCharCode(byte_value);
        } else {
            char = '.';
        }

        ascii_data = ascii_data.concat(char);
    }

    debugger_write_output(ascii_data, null, true);
}

function debugger_gadget_read_memory(address, args)
{
    let memory_contents;
    let mem_args = {
        region_size: 1,
        base_address: 0
    };

    let parts = args[1].split(' ');

    if (parts.length == 2 && parts[0].includes('/')) {
        mem_args.region_size = parseInt(parts[0].replace('/', ''), 0);
        mem_args.base_address = parseInt(parts[1], 0);
    } else if (parts.length == 1) {
        mem_args.base_address = parseInt(parts[0], 0);
    } else {
        debugger_write_output('Error: ', 'red');
        debugger_write_output('The arguments "');
        debugger_write_output(args[1], 'blue');
        debugger_write_output('" to the read command are invalid.');
        return;
    }

    memory_contents = ipc.sendSync('pgb-read-region', mem_args);

    for (let i = 0; i < memory_contents.length; i += 16) {
        let row_size = (i + 16 < memory_contents.length) ? 16 : (memory_contents.length - i);

        debugger_gadget_dump_memory_row(memory_contents, (mem_args.base_address + i), i, row_size);
    }
}

function debugger_gadget_read_register(register)
{
    const r16_names = ['af', 'bc', 'de', 'hl', 'sp', 'pc'];
    const r8_names = ['a', 'b', 'c', 'd', 'e', 'f', 'h', 'l'];

    let register_values;

    register = register.replace('$', '');

    if (r16_names.indexOf(register) == -1 &&  r8_names.indexOf(register) == -1) {
        debugger_write_output("Error: ", "red");
        debugger_write_output("The register ");
        debugger_write_output(register, "blue");
        debugger_write_output(" is not valid.");
        return;
    }

    register_values = ipc.sendSync('pgb-read-registers');
    if (r16_names.indexOf(register) > -1) {
        let value = util.format("0x%s", ("0000" + register_values[register].toString(16)).substr(-4));
        debugger_write_output(util.format("$%s = %s", register, value));
    } else {
        debugger_write_output('WARNING: ', 'red');
        debugger_write_output('Reading single byte registers not implemented yet.');
    }
}

function debugger_gadget_read(args)
{
    let target;

    if (args.length < 2) {
        debugger_write_output("ERROR: ", "red");
        debugger_write_output(util.format("The read gadget expects 2 arguments but got %d.", args.length));
        return;
    }

    if (args.length == 2) {
        target = args[1];
    } else if (args.length > 2 && args[1].includes('/')) {
        target = args[2];
    }

    if (target.includes('$')) {
        debugger_gadget_read_register(target);
    } else {
        debugger_gadget_read_memory(target, args);
    }
}

function debugger_gadget_reset(args)
{
    let output_window = document.querySelector("#debugger-output pre");
    output_window.innerHTML = "";
}

function debugger_gadget_write_memory(address, value)
{
    address = parseInt(address, 0);
    value = parseInt(value, 0);

    ipc.sendSync('pgb-write-byte', {address: address, value: value});
}

function debugger_gadget_write_register(register, value)
{
    // let value = parseInt(value, 0);
    // update_register_display();
}

function debugger_gadget_write(args)
{
    let register, address, value;

    if (args.length < 2) {
        debugger_write_output("ERROR: ", "red");
        debugger_write_output(util.format("The write gadget expects 2 arguments but got %d.", args.length));
        return;
    }

    args = args[1].split(' ');

    if (args.length !== 2) {
        debugger_write_output("ERROR: ", "red");
        debugger_write_output("Missing required arguments for write gadget.");
        return;
    }

    if (args[0][0] === '$') {
        debugger_gadget_write_register(args[0].substr(1), args[1]);
    } else {
        debugger_gadget_write_memory(args[0], args[1]);
    }
}

function debugger_gadget_step(args)
{
    let registers, pc, decoded_position;
    ipc.sendSync('pgb-cpu-step');

    update_register_display();
    update_debugger_disasm();

    registers = ipc.sendSync('pgb-read-registers');
    pc = util.format("%s ", ("0000" + registers.pc.toString(16)).substr(-4));
    decoded_position = ipc.sendSync('pgb-fetch-instructions', 1);
    debugger_write_output(util.format("$PC = %s, %s", pc, JSON.stringify(decoded_position)));
}

const debugger_commands = [
    {id: 'break', func: debugger_gadget_break},
    {id: 'reset', func: debugger_gadget_reset},
    {id: 'continue', func: debugger_gadget_continue},
    {id: 'help', func: debugger_gadget_help},
    {id: 'history', func: debugger_gadget_history},
    {id: 'quit', func: debugger_gadget_quit},
    {id: 'read', func: debugger_gadget_read},
    {id: 'step', func: debugger_gadget_step},
    {id: 'write', func: debugger_gadget_write}
];

function split_command(input)
{
    let parts = input.split(' ');
    if (parts.length == 1) {
        return parts
    } else {
        return [parts.shift(), parts.join(' ')];
    }
}

function handle_debug_command(input)
{
    let i;
    let args;
    let output_div = document.querySelector("#debugger-output");
    let output_window = document.querySelector("#debugger-output pre");
    let found_command = null;

    input = input.trim();
    if (input.length == 0)
        return;

    args = split_command(input);

    for (i = 0; i < debugger_commands.length; i++) {
        if (debugger_commands[i].id === args[0]) {
            found_command = debugger_commands[i];
            break;
        }
    }

    if (found_command === null) {
        output_window.innerHTML += util.format(
            '<span class="debugger red">Error:</span> The command ' +
            '<span class="debugger red">"%s"</span> is invalid. Use the ' +
            'command <span class="debugger green">help</span> to see all ' +
            'valid commands.', input);
    } else if (found_command.func !== null) {
        if (debugger_state.history.length == 0 ||
            debugger_state.history[debugger_state.history.length - 1] !== input) {
            debugger_state.history.push(input);
            debugger_state.history_index = debugger_state.history.length - 1;
        }
        found_command.func(args);
    }

    output_window.innerHTML += "<br>";
    output_div.scrollTop = output_div.scrollHeight;
}

function update_register_display()
{
    const register_names = ['af', 'bc', 'de', 'hl', 'sp', 'pc'];
    let registers, register_node, reg_name, flags;

    registers = ipc.sendSync('pgb-read-registers');

    for (let i = 0; i < register_names.length; i++) {
        reg_name = register_names[i];

        register_node = document.querySelector(util.format('#register-%s', reg_name));
        register_node.innerHTML = util.format("0x%s", ("0000" + registers[reg_name].toString(16)).substr(-4));
    }

    flags = (registers['af'] & 0xff) >> 4;
    $("#flag-hc").text((flags & 0x1) ? "1" : "0");
    $("#flag-hc").text((flags & 0x2) ? "1" : "0");
    $("#flag-hc").text((flags & 0x4) ? "1" : "0");
    $("#flag-hc").text((flags & 0x8) ? "1" : "0");
}

function update_debugger_disasm()
{
    let table = $("#debugger-disasm tbody");
    const disassembled_instructions = ipc.sendSync('pgb-fetch-instructions', 5);

    table.empty();

    for (let i = 0; i < disassembled_instructions.length; i++) {
        let row = $("<tr>");
        let comment_td = $("<td>");
        let address = printf("%04x", disassembled_instructions[i].address);
        let raw_data = '';

        if (i == 0) {
            row.css("background-color", "lightgreen");
        }

        row.append($("<td>").text(address));

        for (let j = 0; j < disassembled_instructions[i].raw_data.length; j++) {
            let byte = printf("%02x", disassembled_instructions[i].raw_data[j]);
            raw_data = util.format("%s%s", byte, raw_data);
        }

        row.append($("<td>").text(raw_data));
        row.append($("<td>").text(disassembled_instructions[i].assembly));

        if ('comment_a' in disassembled_instructions[i]) {
            comment_td.append(disassembled_instructions[i].comment_a);
        }

        if ('comment_b' in disassembled_instructions[i]) {
            comment_td.append(disassembled_instructions[i].comment_b);
        }

        row.append(comment_td);

        table.append(row);
    }
}

window.onload = function() {
    const debugger_input = $("#debugger-input");
    const debugger_step = $("#debugger-step");
    const debugger_reset = $("#debugger-reset");
    const debugger_cont = $("#debugger-continue");

    debugger_input.on("keyup", function(event) {
        event.preventDefault();
        if (event.keyCode === 13) {
            let command = document.querySelector("#debugger-input").value;

            if (command == null && debugger_state.previous_command == null) {
                return false;
            }

            command = command.trim();

            if (command.length == 0 && debugger_state.previous_command == null) {
                return false;
            } else if (command.length == 0) {
                command = debugger_state.previous_command;
            } else {
                debugger_write_output(util.format('pgb-debugger> %s', command), null, true);
            }

            handle_debug_command(command);
            debugger_state.previous_command = command;
            document.querySelector("#debugger-input").value = "";
            return false;
        } else if (event.keyCode === 40 || event.keyCode === 38) {
            // /* Down Arrow || UP */
            // let index, value, history_length, direction;

            // history_length = debugger_state.history.length;
            // if (history_length === 0) {
            //     return;
            // }

            // if (event.keyCode == 40) {
            //     direction = 1;
            // } else {
            //     direction = -1;
            // }

            // if (direction < 0) {

            // } else {

            // }

            // // && debugger_state.input_buffer.length == 0
            // // if (debugger_state.history_index == history_length - 1 && debugger_state.prev_history_index == history_length - 1) {
            // //     value = "";
            // // } else if (debugger_state.history_index == history_length - 1) {
            // //     index = debugger_state.history_index;
            // //     debugger_state.prev_history_index = index;
            // //     value = debugger_state.history[index];
            // // } else {
            // //     index = debugger_state.history_index;
            // //     debugger_state.prev_history_index = index;
            // //     debugger_state.history_index += 1;
            // //     value = debugger_state.history[index];
            // // }

            // debugger_input.val(value);
        }
    });

    debugger_step.on('click', function(event) {
        ipc.sendSync('pgb-cpu-step');

        update_register_display();
        update_debugger_disasm();
    });

    debugger_reset.on('click', function(event) {
        ipc.sendSync('pgb-reset');
        update_register_display();
        update_debugger_disasm();
    });

    debugger_cont.on('click', function(event) {
        debugger_gadget_continue();
    });
};

ipc.on('show_debug', function(event, data)
{
    document.querySelector('#renderer').style.width = "200px";
    document.querySelector("#debugger-info").style.display = "block";
    document.querySelector("#debugger-toolbar").style.display = "block";
    document.querySelector("#debugger-console").style.display = "block";

    update_register_display();
    update_debugger_disasm();
});

ipc.on('show_standard', function(event, data)
{
    document.querySelector("#debugger-info").style.display = "none";
    document.querySelector("#debugger-toolbar").style.display = "none";
    document.querySelector("#debugger-console").style.display = "none";
});
