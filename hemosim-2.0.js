"use strict";

var controller = {};

(function(c){
    c.ablating = 0;                 // 0: off, 1: just on, waiting to reset erp_temp, 2: on, 3: off, but has ablated
    c.ablation_target = 0;
    c.erp_temp = 150;               // ablated link erp (e.g. cti->cspa for flutter)
})(controller);


var viewer = {};

(function(v){
    v.canvas = document.getElementById('c1');
    v.canvas2 = document.getElementById('c2');
    if(typeof G_vmlCanvasManager === 'undefined'){  // flashcanvas not active, expects HTML5 canvas
        try {
            v.ctx = v.canvas.getContext('2d');
            v.ctx2 = v.canvas2.getContext('2d');
            v.quit = false;
            v.html5 = true;
        }
        catch(e){
            v.quit = true;
        }
    }
    else {  // flashcanvas active
        try {
            G_vmlCanvasManager.initElement(v.canvas);
            G_vmlCanvasManager.initElement(v.canvas2);
            v.ctx = v.canvas.getContext('2d');
            v.ctx2 = v.canvas2.getContext('2d');
            v.quit = false;
            v.html5 = false;
            console.log = function() {}     // to prevent errors
            $('#warning').css('display', 'block');
            $('#title').text('svtsim lite');
            $('#c0_container').css('width', 810);   // to fix a rendering bug in IE6

/*
            $('#pace_loc').css('width', '150px');   // fixing a bug in IE6-8
            $('#sense_loc').css('width', '150px');
            $('#S1').css('width', '80px');
            $('#S2').css('width', '80px');
            $('#S3').css('width', '80px');
            $('#S4').css('width', '80px');
            $('#S1n').css('width', '50px');
*/

        }
        catch(e){
            v.quit = true;
        }
    }

    v.margin  = 50;                 // canvas left margin
    v.interval= 25;                 // repaint clock interval (ms)
    v.speed = Math.round(100*v.interval/666.66);
                                    // (1000/interval)*speed px/sec
    v.tick = 0;                     // time in millisecond
    v.delta = v.interval/v.speed;   // delta-tick
    v.x = 0;                        // the wrapped x-axis of the next data point to be drawn
    v.y0 = [];                      // the baseline y coordinate of the chanenls
    v.y = [];                       // the current y coordinate of the channels
    v.img = false;                  // image buffer for the pause mode
    v.mouseX1 = -1;                 // mouse X1 (start of the caliper) relative to the canvas left
    v.mouseX2 = -1;                 // mouse X2 (end of caliper) relative to the canvas left
    v.mouseY = -1;                  // mouse Y coordinate relative to the canvas top
    v.mouseWhich = 1;               // 1: X1 is moving, 2: X2 is moving, 3: X1-X2 is fixed and the calipier is moving en block
    v.mouseDeltaX1 = 0;             // is used when mouseWhich === 3
    v.mouseDeltaX2 = 0;             // is used when mouseWhich === 3
    v.canvasLeft = 0;               // canvas X coordinate relative to the main window
    v.canvasTop = 0;                // canvas Y coordinate relative to the main window
    v.paused = false;               // pause state
    v.pausing = false;              // is used in the Lite mode to signal impending pause at the end of the page
    v.caliper = false;              // caliper mode

    v.scheme_color = ["#000", "#f00", "#fff", "#fff", "#f00", "#0f0", "#00f", "#ff0", "#f0f", "#0ff"];
    v.scheme_gray = ["#fff", "#000", "#000", "#000", "#000", "#000", "#000", "#000", "#000", "#000"];
        // colors[0]: background
        // colors[1]: caliper
        // colors[2]: legends
        // colors[3]: ecg
        // colors[4..9]: egm channel
    v.colors = v.scheme_gray;
    v.buf = Array(500);             // is used by run as a buffer for generated EGMs
    v.loop_src = "lv";
    v.halt = false;                 // during calculating steady state
    v.loop_x = -1;                  // x-y coordinate of the P-V loop
    v.loop_y = -1;
})(viewer);

var modeler = {};

(function(m){
    m.model = {};                   // main model graph, populated from 'model.json'
    m.nodes = {};                   // list of currently active nodes (union of scenario.nodes and pacer generated nodes)
    m.links = {};                   // list of currently active links (union of scenario.links and pacer generated links)
    m.scenario = 0;                 // currently active scenario
})(modeler);

var ecg;                            // ECG object
var channels;
var intervals;
var hemo = setup_hemo();

// Function.prototype.bind emulation
// from http://www.angrycoding.com/2011/09/to-bind-or-not-to-bind-that-is-in.html
// it is needed for compatibility with older Safari browsers (e.g. iPad 1)
if (!('bind' in Function.prototype)) {
    Function.prototype.bind = function() {
        var funcObj = this;
        var extraArgs = Array.prototype.slice.call(arguments);
        var thisObj = extraArgs.shift();
        return function() {
            return funcObj.apply(thisObj, extraArgs.concat(
                Array.prototype.slice.call(arguments)
            ));
        };
    };
}


$(function() {
    if(viewer.quit) return;
    $('#no_html5').css('display', viewer.ctx ? 'none' : 'block');
    modeler.base = $('.redirect')[0].name;
    channels = new Channels();
    controller.populate_pacesense();
    intervals = new Intervals();
    viewer.color();

    // viewer events (mainly related to pause and speed/interval change)
    $('#pause').click( viewer.pause.bind(viewer) );
    $('#pause2').click( viewer.pause.bind(viewer) );
    $('#intervals').change( viewer.intervalsChanged.bind(viewer) );
    $('#speed').change( viewer.speedChanged.bind(viewer) );
    $('#refresh').change( viewer.speedChanged.bind(viewer) );
    $('#color').click( viewer.color.bind(viewer) );

    $('#clear').click( viewer.clear_loop.bind(viewer) );
    $('#loop_lv').click(function(){
        viewer.loop_src = "lv";
        viewer.clear_loop();
    });
    $('#loop_rv').click(function(){
        viewer.loop_src = "rv";
        viewer.clear_loop();
    });

/*
    // controller events (mainly related to pacing and ablation)
    $('#pace').click( controller.pace.bind(controller, false) );
    $('#pace_pause').click( controller.pace.bind(controller, true) );
    $('#pace_straight').click( controller.pace_straight.bind(controller) );
    $('#cardiovert').click( controller.cardiovert.bind(controller) );
    $('#ablate').click( controller.ablate.bind(controller) );
*/

    // modeler events (mainly related to change in scenario and reentry analysis)
    $('#scenario').change( modeler.scenarioChanged.bind(modeler) );
/*
    $('#analyze').click( modeler.analyze.bind(modeler, false) );
    $('#detect').click( modeler.detect_circuit.bind(modeler) );
    $('#induce').click( modeler.analyze.bind(modeler, true) );

    $('#surprise_me').click(function() {
        var o = $('#scenario')[0];
        o.selectedIndex = o.options.length-1;
        modeler.scenarioChanged();
    });
    $('#reveal').click(function(){ window.alert(modeler.scenario.caption); });
    //$('#hint_tag').click(function(){ $('#hint').css('display', 'block'); });
*/
    $('.redirect').click( modeler.modelChanged.bind(modeler) );

    $('.slider').slider({
        min: 0,
        max: 1.0,
        step: 0.01,
        change: function(event, ui){ hemo.setval(event.target.id, ui.value); }
    });
    $('.slider').draggable();

    hemo.init_f();

    $('#steady_state').click( hemo.steady_state.bind(this, 100, false) );
    $('#compensate').click( hemo.steady_state.bind(this, 100, true) );
    $('#reset').click(hemo.init_f);

    viewer.clear_loop();

    controller.populate_dropboxes();
    modeler.load_graph('s_nsr');
    modeler.scenarioChanged();
});

/********************** modeler (scenario) ****************************/

modeler.modelChanged = function(event){
        clearInterval(viewer.timer);
        this.base = event.target.name;
        $('#mode_name').text(this.base);
        channels = new Channels();
        controller.populate_pacesense();
        this.load_graph('s_nsr'); // TODO: here we assume that each model has a scenario named s_nsr
        this.scenarioChanged();
}

modeler.load_graph = function(s){
    ecg = new Ecg();

    $.ajax({
        //url: $('#model')[0].href,
        url: "model_"+modeler.base+".js",
        dataType: 'text',
        async: false,
        success: function(data){
            var m = modeler.model = modeler.canonize($.parseJSON(data));
            channels.shortcut();

            // add ECG hooks
            m.nodes["rv"].update = function(t) {
                //document.getElementById('cl').value = Math.round(t-this.t0); // commented out in Hemo
                ecg.stim(t, 1); // Hemo
                hemo.stim(t, 1);
                hemo.update_screen();
            }
            m.nodes["lv"].update = function(t) { ecg.stim(t, 0); }
            m.nodes["csdv"].update = function(t) { ecg.stim(t, 2); }
            m.links["atrium->av"].update = function(t) {
                ecg.stim_atrium(t, this.forward ? +1 : -1);
            }
            // populate the scenario combobox
			$('#scenario').find('option').remove();
            for(var k in m.scenarios){
                var caption = m.scenarios[k].caption;
                $("#scenario").append('<option value="'+k+'" class="scenario">'+caption+'</option>');
            }
            //$("#scenario").append('<option value="s_surprise" class="scenario">Surprise Me!</option>'); // Hemo

            modeler.setup_graph(s);
            viewer.timer = setInterval(viewer.run.bind(viewer), viewer.interval); // the timer is set inside the 'success' event to prevent errors during asynchronous loading
        },
        error: function(){ window.alert("Model.js was not found."); /* TODO: graceful recovery? */ }
    });
}

modeler.scenarioChanged = function(){
    var s = $('#scenario').val();
    if(!s) s = 's_nsr';

    if(s == 's_surprise'){
        // select a random scenario from the list
        var i = Math.floor(Math.random()*($('#scenario option').length-1));
        for(var k in this.model.scenarios) if(i==0){ s = k; break; } else i--;
    }

    this.scenario = this.model.scenarios[s];
    $('#hint').css('display', 'none').html(this.scenario.hint);
    controller.reset_pacing();
    controller.reset_ablation();
    this.setup_graph(s);
    channels.select(this.scenario.channels);
    viewer.paint_frame();
    $('#ablate').prop('disabled', !this.scenario.target);
    if(!this.scenario.target)
        controller.ablation_target = null;
    else
        controller.ablation_target = this.model.links[this.scenario.target];
}

modeler.setup_graph = function(s){
    var k;
    for(k in this.model.nodes) this.model.nodes[k].state = 9; // lock all nodes
    for(k in this.model.links) this.model.links[k].state = 9; // lock all links
    this.nodes = this.model.scenarios[s].nodes;
    this.links = this.model.scenarios[s].links;
    for(k in this.nodes) this.nodes[k].state = 0;             // now unlock those of current scenario
    for(k in this.links) this.links[k].state = 0;
    //this.randomize($('#randomize')[0].checked);

    // logger request to add a log for the scenario selection
    // random number prevents caching
    $.get("/cgi-bin/logger.php", {"s": s, "v": (viewer.html5 ? "H5" : "IE"), "r": Math.random(), "h": 1});
}


/*
    converts the tree obtained from model.json to the model/node/link/scenario graph
*/
modeler.canonize = function(j){
    var i, k;
    var m  = {nodes:{}, links:{}, scenarios:{}};

    for(k in j.nodes){
        // key, cl, and erp are provided by JSON
        var n = j.nodes[k];
        m.nodes[k] = create_node(k, n.erp, n.cl);
        m.nodes[k].cl = evaluate(m.nodes[k].cl0, 1000);
    }
    for(k in j.links){
        // key, from, to, bi, erp, and delay are provided by JSON
        var l = j.links[k];
        m.links[k] = create_link(k, m.nodes[l.from], m.nodes[l.to], l.bi, l.delay, l.erp);
    }
    for(k in j.scenarios){
        // key, base, nodes, links, caption, loop and hint are provided by JSON
        var s = j.scenarios[k];
        var r = {nodes:{}, links:{}, caption:"", loop:[], hint:""};
        m.scenarios[k] = r;
        r.name = k;
        r.caption = s.caption;
        r.loop = s.loop;
        r.hint = s.hint;
        r.channels = s.channels;
        r.target = s.target;

        if(s.base){
            r.base = m.scenarios[s.base];
            for(i in r.base.nodes) r.nodes[i] = r.base.nodes[i];
            for(i in r.base.links) r.links[i] = r.base.links[i];
        }
        for(i in s.nodes)
            if(s.nodes[i].charAt(0) == '-')    // '-' as the first character in a nodes list removes that node from the list
                delete r.nodes[s.nodes[i].substring(1)];
            else
                r.nodes[s.nodes[i]] = m.nodes[s.nodes[i]];
        for(i in s.links)
            if(s.links[i].charAt(0) == '-')    // '-' as the first character in a links list removes that link from the list
                delete r.links[s.links[i].substring(1)];
            else
                r.links[s.links[i]] = m.links[s.links[i]];
    }
    return m;
}

modeler.randomize = function(doit) {
    function gaussian() {
        /*
            from http://www.protonfish.com/jslib/boxmuller.shtml
            standard Box-Muller Transorm to generate Gaussian random numbers
        */
        var x = 0, y = 0, rds, c;

	    // Get two random numbers from -1 to 1.
	    // If the radius is zero or greater than 1, throw them out and pick two new ones
	    // Rejection sampling throws away about 20% of the pairs.
	    do {
	    x = Math.random()*2-1;
	    y = Math.random()*2-1;
	    rds = x*x + y*y;
	    }
	    while (rds == 0 || rds > 1)

	    // This magic is the Box-Muller Transform
	    c = Math.sqrt(-2*Math.log(rds)/rds);

	    // It always creates a pair of numbers. I'll return them in an array.
	    // This function is quite efficient so don't be afraid to throw one away if you don't need both.
	    return x*c;
    }

	var scale = doit ? 1.0 + gaussian()*0.2 : 1.0;
    for(var n in this.nodes) this.nodes[n].scale = scale;
    for(var l in this.links) this.links[l].scale = scale;
}



/********************* Channels **************************/

/**
    @constructor
*/
function Channels(){
    $.ajax({
        //url: $('#channels')[0].href,
        url: "channels_"+modeler.base+".js",
        dataType: 'text',
        async: false,
        success: function(data){
            Channels.prototype.model = $.parseJSON(data);
            Channels.prototype.nchans = Channels.prototype.model.length;
        },
        error: function(){ window.alert("Channels definition was not found."); }
    });

    this.labels = {}            // is used for reverse index search based on the label
    this.mask = [];             // list of indices based on the current scenario 'channels'
    for(var i=0; i<this.nchans; i++){
        this.labels[this.model[i].label] = i;
        this.mask.push(i);
    }
}

Channels.prototype = {
    constructor : Channels,

    advance0 : function(buf, index, tick){
        for(var i=0; i<this.nchans; i++){
            var s = this.model[this.mask[i]].egm;
            var signal = 0;
            for(var j in s){
                signal += s[j].coef * s[j].target.egm(tick, s[j].width, s[j].pitch);
            }
            buf[index++] = signal;
        }
        return index;
    },

    advance : function(buf, index, tick){},

    generate : function(){
        /*
            dynamically generates an 'advance' function by assembling a string based on
            the current scenario and calling Function constructor. If it is unsuccessful,
            the generic 'advance0' is used.
        */
        var fn = "var m = modeler.nodes;\n";
        for(var i=0; i<this.nchans; i++){
            var s = this.model[this.mask[i]].egm;
            fn += "buf[index++] = ";
            var first = true;
            for(var j in s){
                var n = s[j].node;
                fn += (first ? "" : "+") + (s[j].coef==1 ? "" : s[j].coef+"*");
                if(n == "abl")
                    fn += "this.egm(t, " + s[j].width +", "+ s[j].pitch +")";
                else if(n == "ecg")
                    fn += "ecg.egm(t, " + s[j].width +", "+ s[j].pitch +")";
                else if(n.substr(0, 2) == "P_")    // Hemo
                    fn += "hemo.gamma*hemo." + n;
                else
                    fn += "m." + n + ".egm(t, " + s[j].width +", "+ s[j].pitch +")";
                first = false;
            }
            fn += ";\n";
        }
        fn += "return index;";
        try {
            this.advance = new Function("buf, index, t", fn);
        }
        catch(e){
            console.log("Error in generating dynamic 'advance' function");
            this.advance = this.advance0;
        }
    },

    label : function(i){
        var s = this.model[this.mask[i]].label;
        return s.split('@')[0];
    },

    scheme : function(i){
        return this.model[this.mask[i]].scheme;
    },

    egm : function(t, w, u) {   // helper for use by 'abl'
        return controller.ablating==2 ? Math.random() : 0;
    },

    shortcut : function(){      // adds a property ('target') to egm items based on the name of the node
        for(var i=0; i<this.nchans; i++){
            var s = this.model[i].egm;
            for(var j in s){
                var n;
                if(s[j].node == 'ecg')
                    n =  ecg;
                else if(s[j].node == 'abl')
                    n = this;
                else
                    n = modeler.model.nodes[s[j].node];
                s[j].target = n;
            }
        }
    },

    select : function(channels){    // selects a subset of the channels based on the current scenario
        this.mask = [];
        if(channels){
            for(var i in channels){
                this.mask.push(this.labels[channels[i]]);
            }
            this.nchans = channels.length;
            this.generate();
        }
        else
            this.nchans = 0;

        var s = '<div style="color: #8888FF;">HR</div></b><div class="measure" id="m_hr" style="width: 45px; margin: 5px;">0</div><br>';
        for(var i=0; i<this.nchans; i++){
            s += '<div style="font: 12px ariel; color: '+viewer.colors[this.scheme(i)]+'"><input id="chan_'+i+'" type="checkbox" checked="checked"></input>'+this.label(i)+'</div>'
        }
        $('#c0').html(s);
    }
}

/************************ viewer (run) ****************************/

viewer.egm = function(x, w, u){
	return Math.random()*0.02+(x>w ? 0 : Math.sin(x*Math.PI/w)*(Math.abs(x/u-Math.round(x/u))-0.25))
}

/*
    'run' is the main repaint function and is called every 'interval' ms by the timer.
    It calculates 'speed' data points for each channels, then it calls 'draw' to repainr the screen.
*/
viewer.run = function(){
    if(this.paused || this.halt){
        return;
    }
    /*
        'buf' is a two-dimensional [chan][speed] array to hold channel data
        the reason it is needed is that
        'run' generates data in speed->chan order
        'draw' paints in chan->speed order
    */
    var index = 0;
    for(var i=0; i<this.speed; i++){
        for(var n in modeler.nodes) modeler.nodes[n].run(this.tick);
        for(var l in modeler.links) modeler.links[l].run(this.tick);
        ecg.run(this.tick);
        hemo.advance(this.tick);                // Hemo
        index = channels.advance(viewer.buf, index, this.tick);
        this.tick += this.delta;
    }
    controller.run_ablation();
    var cross = this.draw();
    this.x += this.speed;
    if(cross && viewer.pausing) viewer.pause_ex();
}

viewer.paint_progress = function(percent){
    var w = this.canvas.width;              // canvas width
    var h = this.canvas.height;             // canvas height
    var w1 = 200;
    var h1 = 20;

    this.ctx.beginPath();
    this.ctx.strokeStyle = "#999";
    this.ctx.lineWidth = 2;
    this.ctx.moveTo((w-w1)/2, (h-h1)/2);
    this.ctx.lineTo((w+w1)/2, (h-h1)/2);
    this.ctx.lineTo((w+w1)/2, (h+h1)/2);
    this.ctx.lineTo((w-w1)/2, (h+h1)/2);
    this.ctx.lineTo((w-w1)/2, (h-h1)/2);
    this.ctx.stroke();

    this.ctx.fillStyle = hemo.compensate ? '#F00' : '#0F0';
	this.ctx.fillRect((w-w1)/2+2, (h-h1)/2+2, Math.round((w1-4)*percent), h1-4);
}

viewer.draw = function(){
    var w = this.canvas.width;              // canvas width
    var h = this.canvas.height;             // canvas height
	var ww = Math.floor((w-this.margin)/this.speed)*this.speed;
	var ll = Math.floor(this.x/ww)*ww;
    this.ctx.fillStyle = viewer.colors[0];
	this.ctx.fillRect(this.margin+this.x-ll,0,this.speed+3,h);

    // paint the channels
    var nchans = channels.nchans;
	for(var chan=0; chan<nchans; chan++){
        if(!$('#chan_'+chan).prop('checked')) continue;
        var x0 = this.margin+this.x-ll;
        var y0 = this.y[chan];
		this.ctx.beginPath();
		this.ctx.strokeStyle = viewer.colors[channels.scheme(chan)];
        this.ctx.lineWidth = (chan==0 ? 1 : 2); // Hemo
		this.ctx.moveTo(x0-1, y0);
		for(var i=0; i<this.speed; i++){
            if(chan==0){
                y0 = this.y0[chan] + 100*viewer.buf[chan+i*nchans];
            }
            else {
                y0 = this.y0[chan] - viewer.buf[chan+i*nchans]*(h-150)/150.0;
            }
			this.ctx.lineTo(x0+i, y0);
		}
        this.y[chan] = y0;
		this.ctx.stroke();
	}

    // paint tick marks and the vertical line (new in Hemo)
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.colors[2];
    this.ctx.moveTo(this.margin-1, 0);
    this.ctx.lineTo(this.margin-1, h);
	this.ctx.strokeStyle = "#999";
    var k0 = Math.floor((this.x-1)*this.delta/100);
	for(var i=0; i<this.speed; i++){
        var k = Math.floor(this.x*this.delta/100);
        if(k>k0){
		    this.ctx.moveTo(this.margin+this.x-ll+i, h);
            this.ctx.lineTo(this.margin+this.x-ll+i, h-10);
        }
        k0 = k;
	}
	this.ctx.stroke();

    viewer.draw_loop();

    return this.x-ll+this.speed >= ww;  // = cross
}

viewer.draw_loop = function(){
    var w = this.canvas2.width;
    var h = this.canvas2.height;

    if(this.loop_src === "lv"){
        if(this.loop_x > 0){
            this.ctx2.beginPath();
		    this.ctx2.strokeStyle = viewer.colors[channels.scheme(1)];
            this.ctx2.moveTo(this.loop_x, this.loop_y);
            this.ctx2.lineTo(hemo.V_lv, h - hemo.P_lv);
            this.ctx2.stroke();
        }
        this.loop_x = hemo.V_lv;
        this.loop_y = h - hemo.P_lv;
        //this.ctx2.fillStyle = viewer.colors[channels.scheme(1)];
        //this.ctx2.fillRect(hemo.V_lv, h - hemo.P_lv, 2, 2);
    }
    else {
        if(this.loop_x > 0){
            this.ctx2.beginPath();
		    this.ctx2.strokeStyle = viewer.colors[channels.scheme(2)];
            this.ctx2.moveTo(this.loop_x, this.loop_y);
            this.ctx2.lineTo(hemo.V_rv, h - 5.0*hemo.P_rv);
            this.ctx2.stroke();
        }
        this.loop_x = hemo.V_rv;
        this.loop_y = h - 5.0*hemo.P_rv;
        //this.ctx2.fillStyle = viewer.colors[channels.scheme(2)];
        //this.ctx2.fillRect(hemo.V_rv, h - 5.0*hemo.P_rv, 2, 2);
    }
}

viewer.clear_loop = function(){
    var w = this.canvas2.width;
    var h = this.canvas2.height;

    this.ctx2.fillStyle = viewer.colors[0];
	this.ctx2.fillRect(0, 0, w, h);
    this.loop_x = -1;
    this.loop_y = -1;
}


/*
    Event handler for both Refresh and Speed comboboxes
    calculates 'interval', 'speed' and 'delta' and resets the timer
*/
viewer.speedChanged = function(){
    this.interval = 1000/$("#refresh").val();
    clearInterval(this.timer);
    this.timer = setInterval(this.run.bind(viewer), this.interval);
    this.speed = Math.round($("#speed").val()*this.interval/666.667);
    this.delta = this.interval/this.speed;
    this.x=0;
}


viewer.intervalsChanged = function(){
    var s = $('#intervals').val();
    var w = this.canvas.width;
    var h = this.canvas.height;
    var ww = Math.floor((w-this.margin)/this.speed)*this.speed;    // the drawing area width calculated by the 'draw' function
    var fix = w - (ww+this.margin);  // correction for the gap on the right side of the screen during pause
    var x0 = w - this.tick/this.delta - fix;

    if(this.img==null) this.img = this.ctx.getImageData(0, 0, w, h);

    if(s == 'RR'){
        this.paint_caliper(x0+intervals.r2/this.delta, x0+intervals.r1/this.delta, h/2-60, "RR=");
    }
    else if(s == 'PP'){
        this.paint_caliper(x0+intervals.p2/this.delta, x0+intervals.p1/this.delta, h/2-40, "PP=");
    }
    else if(s == 'PR'){
        if(intervals.r1 >= intervals.p1)
            this.paint_caliper(x0+intervals.p1/this.delta, x0+intervals.r1/this.delta, h/2-20, "PR=");
        else
            this.paint_caliper(x0+intervals.p1/this.delta, x0+intervals.r0/this.delta, h/2-20, "PR=");
    }
    else if(s == 'AH'){
        this.paint_caliper(x0+intervals.a1/this.delta, x0+intervals.h1/this.delta, h/2, "AH=");
    }
    else if(s == 'HV'){
        this.paint_caliper(x0+intervals.h1/this.delta, x0+intervals.r1/this.delta, h/2+20, "HV=");
    }
    else if(s == 'VA'){
        this.paint_caliper(x0+intervals.r1/this.delta, x0+intervals.a1/this.delta, h/2+40, "VA=");
    }
}

viewer.color = function(){
    this.colors = (this.colors==this.scheme_color ? this.scheme_gray : this.scheme_color);
    this.paint_frame();
    this.clear_loop();
    $('#c0').css('background-color', this.colors[0]);
}

viewer.paint_frame = function(){
    var w = this.canvas.width;               // canvas width
    var h = this.canvas.height;              // canvas height
    this.ctx.fillStyle = this.colors[0];
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.strokeStyle = this.colors[2];
    this.ctx.moveTo(this.margin-1, 0);
    this.ctx.lineTo(this.margin-1, h);
    this.ctx.strokeStyle = this.colors[2];
    this.ctx.moveTo(this.margin-1, 0);
    this.ctx.lineTo(this.margin-1, h);
    this.ctx.stroke();

    // Hemo
    this.ctx.strokeStyle = "#999";
    this.ctx.fillStyle = "#999";
    var y0 = h-50;
    var y1 = 100;
    this.ctx.moveTo(this.margin-1, y0);
    this.ctx.lineTo(this.margin-20, y0);
    this.ctx.fillText("0", this.margin-40, y0-5);
    this.ctx.moveTo(this.margin-1, y1);
    this.ctx.lineTo(this.margin-20, y1);
    this.ctx.fillText("150", this.margin-40, y1-5);
    for(var i=1; i<6; i++){
        var y = (y0*i+y1*(6-i))/6;
        this.ctx.moveTo(this.margin-1, y);
        this.ctx.lineTo(this.margin-10, y);
        this.ctx.fillText(25*(6-i), this.margin-40, y-5);
    }
    this.ctx.stroke();


    // end Hemo

    this.ctx.font = "bold 16px sans-serif";
    for(var chan=0; chan<channels.nchans; chan++){
        //this.y[chan] = this.y0[chan] = h*(chan+1)/(channels.nchans+1);
        this.y[chan] = this.y0[chan] = (chan==0 ? 50 : h-50); // Hemo
        //this.ctx.fillStyle = viewer.colors[channels.scheme(chan)];
	    //this.ctx.fillText(channels.label(chan), 5, 25+25*chan);
    }
    this.ctx.fillStyle = this.colors[0];
}

/********************* viewer (pause and caliper) ***********************/

// from: http://willdaniels.co.uk/mandelbrot.html
viewer.findCanvasPosition = function(){
  var tmp = this.canvas;
  this.canvasLeft = 0;
  this.canvasTop = 0;
  if(tmp.offsetParent){
    do {
      this.canvasLeft += tmp.offsetLeft;
      this.canvasTop += tmp.offsetTop;
    }
    while(tmp = tmp.offsetParent);
  }
}

viewer.paint_caliper = function(x1, x2, y, s){
    var h = this.canvas.height;              // canvas height
    this.mouseX1 = x1;
    this.mouseX2 = x2;
    this.mouseY = y;
    if(this.img) this.ctx.putImageData(this.img, 0, 0);
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.colors[1];
    this.ctx.moveTo(x1, 0);
    this.ctx.lineTo(x1, h);
    this.ctx.moveTo(x2, 0);
    this.ctx.lineTo(x2, h);
    this.ctx.moveTo(x1, y);
    this.ctx.lineTo(x2, y);
    this.ctx.fillStyle = this.colors[1];
    this.ctx.font = "18px sans-serif";
    this.ctx.fillText(s+Math.round((x2-x1)*this.delta), 5+x1, y);
    this.ctx.stroke();
}

if(viewer.html5){
    viewer.canvas.onmousedown = (function(e) {
        if(!this.paused) return;
	    var w = this.canvas.width;
        var h = this.canvas.height;
        this.findCanvasPosition();   // moved here in version 2, because combobox is filled dynamically
        var x = e.pageX - this.canvasLeft;
        var y = e.pageY - this.canvasTop;
        if(this.mouseX1 >= 0){
            if(Math.abs(x - this.mouseX2) < 5){         // click is near X1 vertical line
                this.mouseX2 = x;
                this.mouseWhich = +2;
            }
            else if(Math.abs(x - this.mouseX1) < 5){    // click is near X2 vertical line
                this.mouseX1 = x;
                this.mouseWhich = +1;
            }
            else {  // click in not close to the vertical lines
                if((this.mouseX1-x)*(this.mouseX2-x)<0 && Math.abs(y-this.mouseY)<5){ // click is near the horizontal line
                    this.mouseDeltaX1 = this.mouseX1 - x;
                    this.mouseDeltaX2 = this.mouseX2 - x;
                    this.mouseWhich = +3;
                }
                else {  // click in not near either lines, generate a near caliper
                    this.mouseX1 = this.mouseX2 = x;
                    this.mouseWhich = +2;
                }
            }
        }
        else {
            this.mouseX1 = this.mouseX2 = x;
            this.mouseWhich = +2;
        }
        this.mouseY = y;
        this.caliper = true;
    }).bind(viewer);

    viewer.canvas.onmousemove = (function(e) {
        if(!this.caliper) return;
        var x = e.pageX - this.canvasLeft;
        if(this.mouseWhich === +1){
            this.mouseX1 = x;
        }
        else if(this.mouseWhich === +2){
            this.mouseX2 = x;
        }
        else {      // this.mouseWhich === +3
            this.mouseX1 = x + this.mouseDeltaX1;
            this.mouseX2 = x + this.mouseDeltaX2;
        }
        this.paint_caliper(this.mouseX1, this.mouseX2, this.mouseY, "");
    }).bind(viewer);

    viewer.canvas.onmouseup = (function() {
        this.caliper = false;
    }).bind(viewer);

    /*
        Autoaligns the screen upon pause
        shuffles the screen using the image buffer (img)
    */
    viewer.align = function(){
        var w = this.canvas.width;               // canvas width
        var h = this.canvas.height;              // canvas height
        var ww = Math.floor((w-this.margin)/this.speed)*this.speed;
        var ll = Math.floor(this.x/ww)*ww;

        var l = this.ctx.getImageData(this.margin, 0, this.x-ll, h);
        var r = this.ctx.getImageData(this.margin+this.x-ll, 0, ww-this.x+ll, h);
        this.ctx.putImageData(r, this.margin, 0);
        this.ctx.putImageData(l, this.margin+ww-this.x+ll, 0);
        this.x = 0;
    }

    viewer.pause = function(){
        var w = this.canvas.width;               // canvas width
        var h = this.canvas.height;              // canvas height
        this.paused = !this.paused;
        if(this.paused){
            if($('#align').prop('checked')) this.align();
            this.img = this.ctx.getImageData(0, 0, w, h);
            this.caliper = false;
        }
        else {
            if(this.img) this.ctx.putImageData(this.img, 0, 0);   // clears the caliper before resuming
            this.img = 0;
        }
        this.mouseX1 = this.mouseX2 = this.mouseY = -1;
        $('#pause').val(this.paused ? 'Resume' : 'Pause');
        //$('#pause2').val(this.paused ? 'Resume' : 'Pause');
        $('#pace_straight').prop('disabled', this.paused);
        $('#pace').prop('disabled', this.paused);
        $('#pace_pause').prop('disabled', this.paused);
        $('#intervals').prop('disabled', !this.paused);
        $('#intervals').val('Select Interval');
    }

    viewer.pause_ex= function(){}
}
else {  // !viewer.html5
    viewer.pause_ex = function(){
        this.paused = !this.paused;
        this.pausing = false;
        $('#pause').val(this.paused ? 'Resume' : 'Pause');
        $('#pause2').val(this.paused ? 'Resume' : 'Pause');
        $('#pause').prop('disabled', false);
        $('#pause2').prop('disabled', false);
        $('#pace_straight').prop('disabled', this.paused);
        $('#pace').prop('disabled', this.paused);
        $('#pace_pause').prop('disabled', this.paused);
        $('#intervals').prop('disabled', !this.paused);
        $('#intervals').val('Select Interval');
    }

    viewer.pause = function(){
        if(this.paused){
            this.pause_ex();
        }
        else {
            $('#pause').val('Pausing');
            $('#pause2').val('Pausing');
            $('#pause').prop('disabled', true);
            $('#pause2').prop('disabled', true);
            this.pausing = true;
        }
    }
}

/********************* controller (pace & ablate) **********************/

controller.populate_dropboxes = function(){
    function populate(s, _min, _max, _step, _default){
        var t;

        $(s).find('option').remove();
        if(_default == 0)
            $(s).append('<option value="'+0+'" selected="selected">&nbsp;0</option>');
        for(t=_max; t>=_min; t-=_step){
            if(t == _default)
                $(s).append('<option value="'+t+'" selected="selected">'+t+'</option>');
            else
                $(s).append('<option value="'+t+'">'+t+'</option>');
        }
    }

    populate('#S1', 150, 700, 10, 600);
    populate('#S1n', 2, 20, 1, 8);
    populate('#S2', 100, 500, 10, 0);
    populate('#S3', 100, 500, 10, 0);
    populate('#S4', 100, 500, 10, 0);
}

controller.populate_pacesense = function(){
    $('#pace_loc').find('option').remove();
    $('#sense_loc').find('option').remove();
    $('#sense_loc').append('<option value="none" selected="selected">None</option>');
    var c = channels.model;
    var first = true;
    for(var i in c){
        if(c[i].pace){
            if(first){
                $('#pace_loc').append('<option value="'+c[i].pace+'" selected="selected">'+c[i].label+'</option>');
                first = false;
            }
            else
                $('#pace_loc').append('<option value="'+c[i].pace+'">'+c[i].label+'</option>');
        }
        if(c[i].sense){
            $('#sense_loc').append('<option value="'+c[i].sense+'">'+c[i].label+'</option>');
        }
    }
}

controller.remove_pacer = function(){
    for(var n in modeler.nodes) if(modeler.nodes[n].name.charAt(0) == '@') delete modeler.nodes[n];
    for(var l in modeler.links) if(modeler.links[l].name.charAt(0) == '@') delete modeler.links[l];
}

controller.pace = function(do_pause){
    this.remove_pacer();

    var s1 = Number($('#S1').val());
    var s2 = Number($('#S2').val());
    var s3 = Number($('#S3').val());
    var s4 = Number($('#S4').val());
    var s1n = Number($('#S1n').val());

    if(s1<100 || s1>2000){
        window.alert("S1 should be between 100-2000 ms");
        return;
    };
    if(s2!=0 && (s2<100 || s2>1000)){
        window.alert("S2 should be either 0 or between 100-1000 ms");
        return
    }
    if(s3!=0 && (s3<100 || s3>1000)){
        window.alert("S3 should be either 0 or between 100-1000 ms");
        return
    }
    if(s4!=0 && (s4<100 || s4>1000)){
        window.alert("S4 should be either 0 or between 100-1000 ms");
        return
    }
    if(s1n<1 || s1n>50){
        window.alert("Number of S1s should be between 1-50");
        return;
    };

    var i, n=[], last;
	var n0 = modeler.nodes[$('#pace_loc').val()];

    for(i=0; i<s1n; i++) (last=n[i]=create_add_node("@S1."+i, Math.MAX_VALUE)).out.push(n0);  // note @ in front of the name, this is required for the pacing artifact
	for(i=0; i<s1n-1; i++) create_add_link("@S1->S1"+i, n[i], n[i+1], false, s1);
    if(s2>=100){
        (last=n[s1n]=create_add_node("@S2", 100)).out.push(n0);
        create_add_link("@S1->S2", n[s1n-1], n[s1n], false, s2);
    }
    if(s3>=100){
        (last=n[s1n+1]=create_add_node("@S3", 100)).out.push(n0);
        create_add_link("@S2->S3", n[s1n], n[s1n+1], false, s3);
    }
    if(s4>=100){
        (last=n[s1n+2]=create_add_node("@S4", 100)).out.push(n0);
        create_add_link("@S3->S4", n[s1n+1], n[s1n+2], false, s4);
    }

	if($("#sense_loc").val() == "none")
		n[0].stim(viewer.tick, n[0]);
	else
		create_add_link("@sense", modeler.nodes[$('#sense_loc').val()], n[0], false, 0);

    $('#pace').prop('disabled', true);
    $('#pace_pause').prop('disabled', true);
    $('#pace_straight').prop('disabled', true);
    if(do_pause) $(last.name.replace('@', '#')).focus();

    var end = create_add_node("@end", 100);
    n.push(end);
    end.update = function(){
        $('#pace').prop('disabled', false);
        $('#pace_pause').prop('disabled', false);
        $('#pace_straight').prop('disabled', false);
        if(do_pause) viewer.pause();
        controller.remove_pacer();
    }
    create_add_link("@->end", last, end, false, 1000);
}

controller.pace_straight = function(){
    if($('#pace_straight').val() == 'Stop Pacing'){
        this.reset_pacing();
        return;
    }
    $('#pace_straight').val('Stop Pacing');

    for(var n in modeler.nodes) if(modeler.nodes[n].name.charAt(0) == '@') delete modeler.nodes[n];
    for(var l in modeler.links) if(modeler.links[l].name.charAt(0) == '@') delete modeler.links[l];

    var s1 = Number($('#S1').val());

    if(s1<100 || s1>2000){
        window.alert("S1 should be between 100-2000 ms");
        return;
    };

    var n0 = modeler.nodes[$('#pace_loc').val()];

    var n = create_add_node("@S1", 100, s1); // note @ in front of the name, this is required for the pacing artifact
    n.out.push(n0);
    n.update = function(t) { this.cl = Number($('#S1').val()); }

    $('#pace').prop('disabled', true);
    $('#pace_pause').prop('disabled', true);
    $('#S1').focus();

    n.stim(viewer.tick, n);
}

controller.cardiovert = function(){
    for(var n in modeler.nodes) if(modeler.nodes[n].name.charAt(0) == '@') delete modeler.nodes[n];
    for(var l in modeler.links) if(modeler.links[l].name.charAt(0) == '@') delete modeler.links[l];
    for(var n in modeler.nodes) modeler.nodes[n].reset(viewer.tick);
    for(var l in modeler.links) modeler.links[l].reset(viewer.tick);
}

controller.reset_pacing = function(){
    for(var n in modeler.nodes) if(modeler.nodes[n].name.charAt(0) == '@') delete modeler.nodes[n];
    for(var l in modeler.links) if(modeler.links[l].name.charAt(0) == '@') delete modeler.links[l];

    $('#pace_straight').val("Pace Straight");
    $('#pace').prop('disabled', false);
    $('#pace_pause').prop('disabled', false);
}

controller.ablate = function(){
    if($('#ablate').val() == 'Ablation Off'){
        $('#ablate').val('Ablation On');
        if(this.ablating == 1)
            this.ablating = 0;
        else if(this.ablating == 2)
            this.ablating = 3;
    }
    else {
        $('#ablate').val('Ablation Off');
        if(this.ablating == 0)
            this.ablating = 1;
        else if(this.ablating == 3)
            this.ablating = 2;
    }
}

controller.reset_ablation = function(){
    this.ablating = 0;
}

controller.run_ablation = function(){
    if(!this.ablation_target || this.ablating==0) return;
    if(this.ablating == 1){
        this.erp_temp = this.ablation_target.erp;
        this.ablating = 2;
    }
    if(this.ablating == 2){
        if(this.erp_temp<250)
            this.erp_temp += 0.5;
        else if(this.erp_temp<500)
            this.erp_temp *= 1.005;
        else
            this.erp_temp = 100000;
     }
     this.ablation_target.erp = this.erp_temp;
}

/************************* ECG ***************************/

var ecg_sig = [
    [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09,
        0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19,
        0.2, 0.173, 0.147, 0.12, 0.093, 0.067, 0.040, 0.013, -0.013, -0.040,
        -0.067, -0.093, -0.120, -0.147, -0.173, -0.200, -0.227, -0.253, -0.280, -0.307,
        -0.333, -0.360, -0.387, -0.413, -0.440, -0.467, -0.493, -0.520, -0.547, -0.573,
        -0.600, -0.580, -0.560, -0.540, -0.520, -0.500, -0.480, -0.460, -0.440, -0.420,
        -0.400, -0.380, -0.360, -0.340, -0.320, -0.300, -0.280, -0.260, -0.240, -0.220,
        -0.200, -0.180, -0.160, -0.140, -0.120, -0.100, -0.080, -0.060, -0.040, -0.020,
        0.000, 0.020, 0.040, 0.060, 0.080, 0.100, 0.120, 0.140, 0.160, 0.180,
        0.200, 0.220, 0.240, 0.260, 0.280, 0.300, 0.320, 0.340, 0.360, 0.380,
        0.400, 0.420, 0.440, 0.460, 0.480, 0.500, 0.520, 0.540, 0.560, 0.580,
        0.600, 0.580, 0.560, 0.540, 0.520, 0.500, 0.480, 0.460, 0.440, 0.420,
        0.400, 0.380, 0.360, 0.340, 0.320, 0.300, 0.280, 0.260, 0.240, 0.220,
        0.200, 0.180, 0.160, 0.140, 0.120, 0.100, 0.080, 0.060, 0.040, 0.020,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ],
    [0.000, -0.016, -0.032, -0.048, -0.064, -0.080, -0.096, -0.112, -0.128, -0.144,
        -0.160, -0.176, -0.192, -0.208, -0.224, -0.240, -0.256, -0.272, -0.288, -0.304,
        -0.320, -0.336, -0.352, -0.368, -0.384, -0.400, -0.416, -0.432, -0.448, -0.464,
        -0.480, -0.496, -0.512, -0.528, -0.544, -0.560, -0.576, -0.592, -0.608, -0.624,
        -0.640, -0.656, -0.672, -0.688, -0.704, -0.720, -0.736, -0.752, -0.768, -0.784,
        -0.800, -0.795, -0.790, -0.785, -0.780, -0.775, -0.770, -0.765, -0.760, -0.755,
        -0.750, -0.745, -0.740, -0.735, -0.730, -0.725, -0.720, -0.715, -0.710, -0.705,
        -0.700, -0.705, -0.710, -0.715, -0.720, -0.725, -0.730, -0.735, -0.740, -0.745,
        -0.750, -0.755, -0.760, -0.765, -0.770, -0.775, -0.780, -0.785, -0.790, -0.795,
        -0.800, -0.784, -0.768, -0.752, -0.736, -0.720, -0.704, -0.688, -0.672, -0.656,
        -0.640, -0.624, -0.608, -0.592, -0.576, -0.560, -0.544, -0.528, -0.512, -0.496,
        -0.480, -0.464, -0.448, -0.432, -0.416, -0.400, -0.384, -0.368, -0.352, -0.336,
        -0.320, -0.304, -0.288, -0.272, -0.256, -0.240, -0.224, -0.208, -0.192, -0.176,
        -0.160, -0.144, -0.128, -0.112, -0.096, -0.080, -0.064, -0.048, -0.032, -0.016,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ],
    [0.000, 0.014, 0.029, 0.043, 0.057, 0.071, 0.086, 0.100, 0.114, 0.129,
        0.143, 0.157, 0.171, 0.186, 0.200, 0.214, 0.229, 0.243, 0.257, 0.271,
        0.286, 0.300, 0.314, 0.329, 0.343, 0.357, 0.371, 0.386, 0.400, 0.414,
        0.429, 0.443, 0.457, 0.471, 0.486, 0.500, 0.514, 0.529, 0.543, 0.557,
        0.571, 0.586, 0.600, 0.614, 0.629, 0.643, 0.657, 0.671, 0.686, 0.700,
        0.714, 0.729, 0.743, 0.757, 0.771, 0.786, 0.800, 0.814, 0.829, 0.843,
        0.857, 0.871, 0.886, 0.900, 0.914, 0.929, 0.943, 0.957, 0.971, 0.986,
        1.000, 0.980, 0.960, 0.940, 0.920, 0.900, 0.880, 0.860, 0.840, 0.820,
        0.800, 0.780, 0.760, 0.740, 0.720, 0.700, 0.680, 0.660, 0.640, 0.620,
        0.600, 0.580, 0.560, 0.540, 0.520, 0.500, 0.480, 0.460, 0.440, 0.420,
        0.400, 0.380, 0.360, 0.340, 0.320, 0.300, 0.280, 0.260, 0.240, 0.220,
        0.200, 0.180, 0.160, 0.140, 0.120, 0.100, 0.080, 0.060, 0.040, 0.020,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ]
    ];

var ecg_len = [140.0, 140.0, 140.0];
var nchans = 3;
function Ecg() {
    this.state = 0; // 0: resting, 1: QRS, 2: ST
    this.t0 = -1;
    this.ta = -1;
    this.tt = [];
    for (var i = 0; i < nchans; i++) this.tt[i] = -1;
    this.v1 = 0;
    this.erp = 300;
    this.sum = 0;
    this.points = 0;
    this.dir = +1;
}

Ecg.prototype = {
    stim: function(t, chan) {
        if (this.state == 0) {
            for (var i = 0; i < nchans; i++) this.tt[i] = -1;
            this.erp = (t - this.t0) / 2;
            if (this.erp < 100 || this.erp > 400) this.erp = 200;
            this.tt[chan] = this.t0 = t;
            this.state = 1;
            this.sum = 0;
            this.points = 0;
        }
        else if (this.state == 1) {
            this.tt[chan] = t;
        }
    },

    stim_atrium: function(t, dir) {
        this.ta = t;
        this.dir = dir;
    },

    run: function(t) {
        this.v1 = 0;
        if (this.state == 0) return;
        if (this.state == 2) {
            if (t >= this.t0 + this.erp) this.state = 0;
            return;
        }
        // state==1
        var y = [];
        var f = [];
        var s = 0.0,
            i;
        for (i = 0; i < nchans; i++) {
            if (this.tt[i] == -1 || t - this.tt[i] >= ecg_len[i]) y[i] = f[i] = 0;
            else {
                y[i] = ecg_sig[i][Math.round(t - this.tt[i])];
                f[i] = (t - this.tt[i]) / ecg_len[i];
                s += f[i];
            }
        }
        for (i = 0; i < nchans; i++)
        if (f[i] < 1) this.v1 -= (1 - s) / (1 - f[i]) * y[i];
        if (s >= 1) this.state = 2;
        this.points++;
        this.sum += this.v1;
    },

    egm: function(t, w, u) {
        var noise = Math.random() * 0.05;
        var p = t - this.ta < 60 ? this.dir * Math.sin((t - this.ta) * Math.PI / 60) * 0.15 : 0;
        if (this.state == 1) return noise - p + this.v1;
        if (this.state == 2)
            if (this.t0 + this.erp - t < 100) return noise - p - Math.sin((this.t0 + this.erp - t) * Math.PI / 100) * this.sum / this.points;
        return noise - p;
    }
}

/********************************** Hemodynamics ***************************************/

/****
    Based on Smith-Chase-Nokes-Shaw-Wake (http://www.ncbi.nlm.nih.gov/pubmed/15036180) lumped-parameter model
    The code is a modification of the automatic generated C code downloaded from www.cellml.org
****/

function setup_hemo(){
/*
    constants
    note the const directive is for the Closure compiler
*/
/** @const */    var R_mt = 0.015800;
/** @const */    var R_av = 0.018000;
/** @const */    var R_tc = 0.023700;
/** @const */    var R_pv = 0.005500;
/** @const */    var R_pul = 0.155200;
/** @const */    var R_sys = 1.088900;
/** @const */    var L_tc = 0.000080;
/** @const */    var L_pv = 0.000149;
/** @const */    var L_mt = 0.000077;
/** @const */    var L_av = 0.000122;
/** @const */    var A = 1.000000;
/** @const */    var B = 80.000000;
/** @const */    var C = 0.375000;
/** @const */    var P_0_pcd = 0.500300;
/** @const */    var V_0_pcd = 200.000000;
/** @const */    var lambda_pcd = 0.030000;
/** @const */    var E_es_lvf = 2.879800;
/** @const */    var lambda_lvf = 0.033000;
/** @const */    var P_0_lvf = 0.120300;
/** @const */    var V_d_lvf = 0.000000;
/** @const */    var V_0_lvf = 0.000000;
/** @const */    var E_es_rvf = 0.585000;
/** @const */    var lambda_rvf = 0.023000;
/** @const */    var P_0_rvf = 0.215700;
/** @const */    var V_d_rvf = 0.000000;
/** @const */    var V_0_rvf = 0.000000;
/** @const */    var E_es_spt = 48.754000;
/** @const */    var V_d_spt = 2.000000;
/** @const */    var P_0_spt = 1.110100;
/** @const */    var lambda_spt = 0.435000;
/** @const */    var V_0_spt = 2.000000;
/** @const */    var one = 1.000000;
/** @const */    var E_es_pa = 0.369000;
/** @const */    var V_d_pa = 0.000000;
/** @const */    var E_es_pu = 0.007300;
/** @const */    var V_d_pu = 0.000000;
/** @const */    var E_es_ao = 0.691300;
/** @const */    var V_d_ao = 0.000000;
/** @const */    var E_es_vc = 0.005900;
/** @const */    var V_d_vc = 0.000000;


/*
    temporary variables holding the intermediate values in computeRates
*/
    var V_tot = 1500.0;     // total intravascular volume
    var P_th = -4.000000;   // intra-thoracic pressure
    var V_all;              // instantaneous total volume in ml
    var tension;            // peak LV wall tension used by the compensate routine

    var t0 = 0;             // the last systole time in sec

/*
    temporary variables used in calculating computeRates
    they are here instead on inside computeRates for efficiency (but is it?)
*/
    var tau;                // time since last upstroke in sec
    var e_t;                // current systolic parameter
    var V_pcd;
    var P_pcd;
    var P_peri;
    var V_spt = V_0_spt;
    var V_lvf;
    var P_es_lvf;
    var P_ed_lvf;
    var P_lvf;
    var P_lv;
    var V_rvf;
    var P_es_rvf;
    var P_ed_rvf;
    var P_rvf;
    var P_rv;
    var P_pa;
    var P_ao;
    var P_pu;
    var P_vc;
    var Q_pul;
    var Q_sys;

/*
    f_* are the control variables added to the model
*/
    var f_lv_con;
    var f_rv_con;
    var f_av_s;
    var f_av_r;
    var f_mt_s;
    var f_mt_r;
    var f_pv_s;
    var f_pv_r;
    var f_tc_s;
    var f_tc_r;
    var f_sys_r;
    var f_pul_r;
    var f_peri;
    var f_dyn;
    var f_asd;
    var f_lv_tau;
    var f_rv_tau;
    var f_vol;

    function init_f(){
        f_lv_con = 1.0;     // LV contractility
        f_rv_con = 1.0;     // RV contractility
        f_av_s = 1.0;       // Aortic valve stenosis
        f_av_r = 0;         // Aortic valve regurgitation
        f_mt_s = 1.0;       // Mitral valve stenosis
        f_mt_r = 0;         // Mitral valve regurgitation
        f_pv_s = 1.0;       // Pulmonary valve stenosis
        f_pv_r = 0;         // Pulmonary valve regurgitation
        f_tc_s = 1.0;       // Tricuspid valve stenosis
        f_tc_r = 0;         // Tricuspid valve regurgitation
        f_sys_r = 1.0;      // Systemic resistance (SVR)
        f_pul_r = 1.0;      // Pulmonic resistance (PVR)
        f_peri = 0;         // Pericardial effusion
        f_dyn = 0;          // Left ventricular outflow tract stenosis (HOCM)
        f_asd = 0;          // Atrial septal defect
        f_lv_tau = 1.0;     // LV diastolic function
        f_rv_tau = 1.0;     // RV diastolic function
        f_vol = 1.0;        // Total volume
    }

    init_f();

    function State(){
        this.V_lv = 94.681200;       // V_lv in component left_ventricle (mL)
        this.V_rv = 90.730200;       // V_rv in component right_ventricle (mL)
        this.Q_mt = 245.581300;      // Q_mt in component flow (mL_per_second)
        this.Q_av = 0.000000;        // Q_av in component flow (mL_per_second)
        this.Q_tc = 190.066100;      // Q_tc in component flow (mL_per_second)
        this.Q_pv = 0.000000;        // Q_pv in component flow (mL_per_second)
        this.V_pa = 43.012300;       // V_pa in component pulmonary_artery (mL)
        this.V_pu = 808.457900;      // V_pu in component pulmonary_vein (mL)
        this.V_ao = 133.338100;      // V_ao in component aorta (mL)
        this.V_vc = 329.780300;      // V_vc in component vena_cava (mL)

// there variables are added to the base model
        this.Q_asd = 0.0;            // Q_asd is the left to right flow across ASD
        this.O_sys = 0.0;            // O_sys is the total systemic flow during one cardiac cycle
        this.O_pul = 0.0;            // O_oul is the total pulmonic flow during one cardiac cycle
    };

    var tick = -1;          // tick in ms
    var state = new State;
    var V_tot = state.V_lv + state.V_rv + state.V_pa + state.V_pu + state.V_ao + state.V_vc;
    var current = new State;
    var rate = new State;
    var time_step = 0.001;  // time step 1 ms
    var alpha = 0.001;
    var gamma = 1.4;

    function valve(flow, p1, p2, R, L, f_s, f_r){
        if(p1>p2 || flow>0) return ((p1-p2) - flow*R*f_s)/L;
        return (f_r*(p1-p2)/R - flow)/time_step;
    }

    function residual(V_spt, V_lv, V_rv){
        var x =
            e_t*E_es_spt*(V_spt-V_d_spt) +
            (1.0-e_t)*P_0_spt*(Math.exp(lambda_spt*(V_spt-V_0_spt))-1.0) -
            e_t*E_es_lvf*(V_lv-V_spt) -
            (1.0-e_t)*P_0_lvf*(Math.exp(lambda_lvf*(V_lv-V_spt))-1.0) +
            e_t*E_es_rvf*(V_rv+V_spt) +
            (1.0-e_t)*P_0_rvf*(Math.exp(lambda_rvf*(V_rv+V_spt))-1.0);
        return x;
    }

    function diff_residual(V_spt, V_lv, V_rv){
        var x =
            e_t*E_es_spt +
            (1.0-e_t)*P_0_spt*lambda_spt*Math.exp(lambda_spt*(V_spt-V_0_spt)) +
            e_t*E_es_lvf +
            (1.0-e_t)*P_0_lvf*lambda_lvf*Math.exp(lambda_lvf*(V_lv-V_spt)) +
            e_t*E_es_rvf +
            (1.0-e_t)*P_0_rvf*lambda_rvf*Math.exp(lambda_rvf*(V_rv+V_spt));
        return x;
    }

    function newton(x, V_lv, V_rv){
        var f = residual(x, V_lv, V_rv);
        var k = 1;
        while(Math.abs(f) > 0.5 && k<5){
            var df = diff_residual(x, V_lv, V_rv);
            x -= f/df;
            f = residual(x, V_lv, V_rv);
            k++;
        }
        return x;
    }


    function computeRates(t, state, rate)
    {
        var old_gradient = P_lv - P_ao;

        V_pcd = state.V_lv + state.V_rv;
        P_pcd = P_0_pcd*(Math.exp(lambda_pcd*(V_pcd - V_0_pcd + f_peri)) - 1.0);
        P_peri = P_pcd + P_th;

        tau = t - t0;
        var corr = hemo.cl>0.36 ? Math.sqrt(hemo.cl) : 0.6;
        e_t = A*Math.exp(-B*Math.pow(tau - C*corr, 2.0));
        P_th = 1.0 + 1.0*Math.sin(t*2*3.141592/5);

        V_spt = newton(V_spt, state.V_lv, state.V_rv);

        V_lvf = state.V_lv - V_spt;
        P_es_lvf = f_lv_con*E_es_lvf*(V_lvf - V_d_lvf)/corr;
        P_ed_lvf = P_0_lvf*(Math.exp( f_lv_tau*lambda_lvf*(V_lvf - V_0_lvf)) - 1.0);
        P_lvf =  e_t*P_es_lvf+ (1.0 - e_t)*P_ed_lvf;
        P_lv = P_lvf + P_peri;
        P_ao =  E_es_ao*(state.V_ao - V_d_ao);
        var f = f_dyn>0 ? (1+Math.pow(100.0*f_dyn/hemo.ed.V_lv, 2)) : 1.0;
        rate.Q_av = valve(state.Q_av, P_lv, P_ao, R_av*f, L_av, f_av_s, f_av_r);

        V_rvf = state.V_rv + V_spt;
        P_es_rvf = f_rv_con*E_es_rvf*(V_rvf - V_d_rvf)/corr;
        P_ed_rvf = P_0_rvf*(Math.exp( f_rv_tau*lambda_rvf*(V_rvf - V_0_rvf)) - 1.0);
        P_rvf = e_t*P_es_rvf+ (1.0 - e_t)*P_ed_rvf;
        P_rv = P_rvf+P_peri;
        P_pa = E_es_pa*(state.V_pa - V_d_pa) + P_th;
        rate.Q_pv = valve(state.Q_pv, P_rv, P_pa, R_pv, L_pv, f_pv_s, f_pv_r);

        P_pu = E_es_pu*(state.V_pu - V_d_pu) + P_th;
        rate.Q_mt = valve(state.Q_mt, P_pu, P_lv, R_mt, L_mt, f_mt_s, f_mt_r);

        P_vc = E_es_vc*(state.V_vc - V_d_vc);
        rate.Q_tc = valve(state.Q_tc, P_vc, P_rv, R_tc, L_tc, f_tc_s, f_tc_r);

        rate.Q_asd = P_pu>P_vc ? (f_asd*(P_pu-P_vc)/R_mt - state.Q_asd)/time_step : 0;

        rate.V_lv = state.Q_mt - state.Q_av;
        rate.V_rv = state.Q_tc - state.Q_pv;
        Q_pul = (P_pa - P_pu)/(R_pul * f_pul_r);
        rate.V_pa = state.Q_pv - Q_pul;
        rate.V_pu = Q_pul - state.Q_mt - state.Q_asd;
        Q_sys = (P_ao - P_vc)/(R_sys * f_sys_r);
        rate.V_ao = state.Q_av - Q_sys;
        rate.V_vc = Q_sys - state.Q_tc + state.Q_asd;

        rate.O_sys = Q_sys;
        rate.O_pul = Q_pul;

        V_all = state.V_lv + state.V_rv + state.V_pa + state.V_pu + state.V_ao + state.V_vc;
        rate.V_vc += (f_vol*V_tot - V_all)*0.01;

        if(old_gradient>0 && P_lv-P_ao<=0){          // end systole
            for(var j in state){
                hemo.es[j] = state[j];
            }
        }

        hemo.pcwp = hemo.pcwp*(1.0-alpha) + P_pu*alpha;
        hemo.cvp = hemo.cvp*(1.0-alpha) + P_vc*alpha;

        tension = P_lv*Math.sqrt(state.V_lv)/f_lv_tau;
        if(tension > hemo.tension){
            hemo.tension = tension;
        }

        if(P_ao > hemo.ao_sys)
            hemo.ao_sys = P_ao;
        if(P_ao < hemo.ao_dia)
            hemo.ao_dia = P_ao;

        if(P_pa > hemo.pa_sys)
            hemo.pa_sys = P_pa;
        if(P_pa < hemo.pa_dia)
            hemo.pa_dia = P_pa;
    }

    /*
        Backward Euler ODE solver
    */
    var integrate = function(tick, state, rate, delta){
        var j, k, v;
        var eps = 0.01; // ml of LV vol

        for(j in state){
            current[j] = state[j];
        }
        for(k=0; k<10; k++){
            v = state.V_lv;
            delta(tick*time_step, state, rate);
            for(j in state){
                state[j] = current[j] + rate[j]*time_step;
            }
            if(Math.abs(v - state.V_lv) < eps) break;
        }
    }

    function replace_integrate(){
        var j;
        var fn = 'var k, v;\n';

        fn += 'var eps = 0.01;\n';

        for(j in state){
            fn += 'var __'+j+' = state.'+j+';\n';
        }

        fn += 'for(k=0; k<10; k++){\n';
        fn += '\tv = state.V_lv;\n';
        fn += '\tdelta(tick*'+time_step+', state, rate);\n';
        for(j in state){
            fn += '\tstate.'+j+' = __'+j+' + rate.'+j+'*'+time_step+';\n';
        }
        fn += '\tif(Math.abs(v - state.V_lv) < eps) break;\n';
        fn += '}\n';

        try {
            //console.log(fn);
            integrate = new Function("tick, state, rate, delta", fn);
        }
        catch(e){
            //console.log("Error in generating dynamic 'integrate' function");
        }
    }

    replace_integrate();

    var hemo = {
        ed: new State(),
        es: new State(),
        gamma: 1.4,
        pcwp: 0.0,
        cvp: 0.0,
        tension: 0.0,
        qs: 0.0,
        qp: 0.0,
        ao_sys: 0.0,
        ao_dia: 0.0,
        pa_sys: 0.0,
        pa_dia: 0.0,
        cl: 1.0,
        compensate: false
    };

    hemo.advance = function(t){
        for(; tick<t; tick++){
            integrate(tick, state, rate, computeRates);
        }
        hemo.P_lv = P_lv;
        hemo.P_rv = P_rv;
        hemo.P_ao = P_ao;
        hemo.P_pa = P_pa;
        hemo.P_pu = P_pu;
        hemo.P_vc = P_vc;
        hemo.V_lv = state.V_lv;
        hemo.V_rv = state.V_rv;
        //viewer.draw_loop();
        return state;
    }

    hemo.run = function(){
        if(hemo.beat++ === hemo.beats){
            tick = hemo.old_tick;
            t0 = hemo.old_t0;
            viewer.halt = false;
            if(hemo.compensate){
                $('#vol').slider("value", (hemo.getval('vol')));
                $('#lv_tau').slider("value", (hemo.getval('lv_tau')));
                hemo.compensate = false;
            }
            $('#steady_state').prop('disabled', false);
            $('#compensate').prop('disabled', false);
            $('#pause').prop('disabled', false);
            return;
        }
        for(var t=0; t<Math.round(hemo.cl*1000); t++, tick++){
            if(0.001*tick-t0 >= hemo.cl) hemo.stim(tick, this);
            integrate(tick, state, rate, computeRates);
        }
        viewer.paint_progress.call(viewer, hemo.beat/hemo.beats);
        setTimeout(hemo.run, 1);
    }

    hemo.steady_state = function(beats, compensate){
        hemo.beats = beats;
        hemo.beat = 0;
        hemo.old_tick = tick;
        hemo.old_t0 = t0;
        hemo.compensate = compensate;
        viewer.halt = true;
        $('#steady_state').prop('disabled', true);
        $('#compensate').prop('disabled', true);
        $('#pause').prop('disabled', true);
        hemo.run();
    }

    hemo.reset = function(){
        state = new State();
        tick = -1;
    }

    hemo.stim = function(t, who){
        hemo.cl = t*0.001 - t0;
        t0 = t*0.001;
        for(var j in state){
                hemo.ed[j] = state[j];
            }
        hemo.qs = state.O_sys;
        hemo.qp = state.O_pul;
        state.O_sys = 0.0;
        state.O_pul = 0.0;
        hemo.ed.P_lv = P_lv;
        hemo.ed.P_rv = P_rv;

        if(hemo.compensate){
            f_vol += 1.0/(1+Math.exp((hemo.qs/hemo.cl-60.0)/10.0)) * 0.01 * (5.0 - f_vol)/5.0;
            f_lv_tau += 1.0/(1+Math.exp(-(hemo.tension-750.0)/25.0)) * 0.01;
        }
        //console.log(hemo.tension);
        hemo.tension = 0.0;
    }

    hemo.reset_bp = function(){
        hemo.ao_sys = P_ao;
        hemo.ao_dia = P_ao;
        hemo.pa_sys = P_pa;
        hemo.pa_dia = P_pa;
    }

    hemo.setval = function(what, val){
        function range(x, a, b){ return x<0 ? a : x>1 ? b : a*(1-x)+b*x; }

        switch(what){
            case "lv_tau": f_lv_tau = range(val, 1.0, 2.0); break;
            case "rv_tau": f_rv_tau = range(val, 1.0, 2.0); break;
            case "av_s": f_av_s = range(val, 1.0, 5.0); break;
            case "av_r": f_av_r = range(val, 0, 0.1); break;
            case "mt_s": f_mt_s = range(val, 1.0, 4.0); break;
            case "mt_r": f_mt_r = range(val, 0, 0.3); break;
            case "pv_s": f_pv_s = range(val, 1.0, 5.0); break;
            case "pv_r": f_pv_r = range(val, 0, 0.5); break;
            case "tc_s": f_tc_s = range(val, 1.0, 4.0); break;
            case "tc_r": f_tc_r = range(val, 0, 0.5); break;
            case "peri": f_peri = range(val, 0, 200.0); break;
            case "sys_r": f_sys_r = range(val, 0.25, 3.0); break;
            case "pul_r": f_pul_r = range(val, 0.25, 3.0); break;
            case "dyn": f_dyn = range(val, 0, 1.0); break;
            case "asd": f_asd = range(val, 0, 1.0); break;
            case "lv_con": f_lv_con = range(val, 0.25, 1.5); break;
            case "rv_con": f_rv_con = range(val, 0.25, 1.5); break;
            case "vol": f_vol = range(val, 0.25, 3.0); break;
        }
    }

    hemo.getval = function(what){
        function unrange(y, a, b){ var x = (y-a)/(b-a); return x<0 ? 0 : (x>1.0 ? 1.0 : x); }

        switch(what){
            case "lv_tau": return unrange(f_lv_tau, 1.0, 2.0);
            case "rv_tau": return unrange(f_rv_tau, 1.0, 2.0);
            case "av_s": return unrange(f_av_s, 1.0, 5.0);
            case "av_r": return unrange(f_av_r, 0, 0.1);
            case "mt_s": return unrange(f_mt_s, 1.0, 4.0);
            case "mt_r": return unrange(f_mt_r, 0, 0.3);
            case "pv_s": return unrange(f_pv_s, 1.0, 5.0);
            case "pv_r": return unrange(f_pv_r, 0, 0.5);
            case "tc_s": return unrange(f_tc_s, 1.0, 4.0);
            case "tc_r": return unrange(f_tc_r, 0, 0.5);
            case "peri": return unrange(f_peri, 0, 200.0);
            case "sys_r": return unrange(f_sys_r, 0.25, 3.0);
            case "pul_r": return unrange(f_pul_r, 0.25, 3.0);
            case "dyn": return unrange(f_dyn, 0, 1.0);
            case "asd": return unrange(f_asd, 0, 1.0);
            case "lv_con": return unrange(f_lv_con, 0.25, 1.5);
            case "rv_con": return unrange(f_rv_con, 0.25, 1.5);
            case "vol": return unrange(f_vol, 0.25, 3.0);
        }
    }

    hemo.init_f = function(){
        init_f();
        var sliders = $(".slider");
        for(var i=0; i<sliders.length; i++){
            $(sliders[i]).slider("value", (hemo.getval(sliders[i].id)));
        }
    }

    return hemo;
}

hemo.update_screen = function(){
    function fix(x){
        return Math.round(x*hemo.gamma);
    }

    $('#m_ao').html(fix(hemo.ao_sys)+"/"+fix(hemo.ao_dia));
    $('#m_lvedv').html(Math.round(hemo.ed.V_lv));
    $('#m_lvesv').html(Math.round(hemo.es.V_lv));
    $('#m_lvef').html(Math.round((hemo.ed.V_lv-hemo.es.V_lv)/hemo.ed.V_lv*100)+"%");
    $('#m_lvedp').html(fix(hemo.ed.P_lv));
    $('#m_pcwp').html(fix(hemo.pcwp));
    $('#m_qs').html(Math.round(hemo.qs));

    $('#m_pa').html(fix(hemo.pa_sys)+"/"+fix(hemo.pa_dia));
    $('#m_rvedv').html(Math.round(hemo.ed.V_rv));
    $('#m_rvesv').html(Math.round(hemo.es.V_rv));
    $('#m_rvef').html(Math.round((hemo.ed.V_rv-hemo.es.V_rv)/hemo.ed.V_rv*100)+"%");
    $('#m_rvedp').html(fix(hemo.ed.P_rv));
    $('#m_cvp').html(fix(hemo.cvp));
    $('#m_qp').html(Math.round(hemo.qp));

    $('#m_hr').html(Math.round(60/hemo.cl));

    hemo.reset_bp();
}
