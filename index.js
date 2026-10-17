let isConnect = false;
let isPhone = false;
let lastSelectedNav = "layout";
// let language = 0; //0:en 1:cn 2:kr
// 画布对象
let canvasPip = null;
let canvasPipW = 600.0;
let canvasPipH = 338.0;
// let canvasChroma = null;
let canvasLogo = null;
// let canvasPat = null;
let selectedLayer = "";
let isPipChange = false;
let isChromaPosChange = false;
let pst;
let pgm;
let mode = 0;
let pip = {};
let logo = {};
let cropSide = -1;
//logo和image尺寸
let logoobj = new Image();
let logoFileData;
let patobj = new Image();
let patFileData;
let uploading = false;
//初始化查询数据循环----避免后端系统未启动无法发送
let initInterval = null;
//系统时间定时器
let timeInterval = null;
//单击双击定时器
let clickInterval = null;
let clickNum = 0;
//音频模块选项
let modeArr = ["OFF", "ON", "AFV"];
let sourceArr = ["IN1", "IN2", "IN3", "IN4", "IN5", "Mic1", "Mic2", "PGM"];
let micModeArr = ["Line in", "Mic"];
//Mask 开关
let regionMaskOn = false;
//远程同步
let remoteSync = false;
//转场效果
let effectIdRec = "0";
//gfx类型
let gfxImageType = 1;
//当前信号源
let cur_sel = [0, 0, 0, 0];
let media_type = 0;
//umd
const umdName = ["pvw", "pgm", "in1", "in2", "in3", "in4", "aux"];
let umd_sig = { umd_sig1: 1, umd_sig2: 1, umd_sig3: 1, umd_sig4: 1 };

// 等待页面加载完成后执行
setTimeout(function () {
  $(document).ready(function () {
    //初始化websocket
    initWebSocket();
    //初始化画布
    initCanvas();
    //设置select选项
    setSelectOptions();
    //设置时间
    $("#sys_date").html(getDate());
    $("#sys_time").html(getTime(0));
    timeInterval = setInterval(function () {
      $("#sys_time").html(getTime(0));
    }, 1000);
    //设置logo
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      console.log("dark");
      $("link[rel='icon']").attr("href", "image/logo_dark.ico");
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      console.log("light");
      $("link[rel='icon']").attr("href", "image/logo_light.ico");
    }
    //获取初始数据
    // initData();

    // window.addEventListener("load", function () {
    // });

    window.addEventListener("unload", function () {
      console.log("stopWebSocket");
      stopWebSocket();
    });

    // window.onresize = function () {
    // };

    //动态设置select选项
    function setSelectOptions() {
      const selectList = $("select");
      for (let index = 0; index < selectList.length; index++) {
        const element = selectList[index];
        $(element).empty();
        const type = $(element).attr("name");
        $(element).html(type.getOptions());
      }
    }
    // 下拉框
    $("select").change(function () {
      if (this.id) {
        let data = {};
        const index = $(this)[0].selectedIndex;
        if (this.id === "play_rate" || this.id === "dip_mode") {
          data[this.id] = Number(index);
          sendMessage(JSON.stringify(data));
        }
      }
    });

    // 底部Tab切换
    $(".link").click(function () {
      $("#main-box").hide();
      $("#media-box").hide();
      $("#audio-box").hide();
      $("#update-box").hide();
      var curHref = $(this).attr("id") + "-box";
      $("#" + curHref).show();
      $(".nav-list div").each(function () {
        $(this).removeClass("selected");
      });
      $(this).addClass("selected");
    });
    $(".nav").click(function () {
      $("#layout_window").hide();
      $("#multiview_window").hide();
      $("#audio_window").hide();
      $("#media_window").hide();
      $("#gfx_window").hide();
      $("#system_window").hide();

      const curHref = $(this).attr("id") + "_window";
      // if (curHref === "media_window" || curHref === "system_window" || curHref === "audio_window") {
      //     $("#" + curHref).show();
      // }
      $("#" + curHref).show();
      $("#" + lastSelectedNav + "_img").prop(
        "src",
        "./image/" + lastSelectedNav + ".png"
      );
      $("#" + $(this).attr("id") + "_img").prop(
        "src",
        "./image/" + $(this).attr("id") + "_sel.png"
      );
      lastSelectedNav = $(this).attr("id");
      $(".nav_list li").each(function () {
        $(this).removeClass("selected");
      });
      $(this).addClass("selected");
    });

    $("#Sys_Language").click(function () {
      language++;
      if (language === languageList.length) {
        language = 0;
      }
      loadProperties(languageList[language]);
      $("#Sys_Language").prop("src", languageImageList[language]);
    });

    //重置
    $("#Sys_Reset").click(function () {
      dialog(
        {
          title: languageMapTemplate[0][language],
          message: languageMapTemplate[13][language],
        },
        function success() {
          let data = {};
          data["sys_reset"] = 1;
          sendMessage(JSON.stringify(data));
          // console.log("确认");
          //复位后延迟15s主动刷新页面
          setTimeout(function () {
            window.location.reload(true);
          }, 10000);
        },
        function cancel() { }
      );
    });

    $("#Sys_Export").click(function () {
      sendMessage(
        JSON.stringify({
          get_file: "/opt/configs_logs.tar.gz",
        })
      );
    });
    $("#Sys_Backlight div").click(function () {
      if (this.id) {
        let id = this.id.substring(this.id.lastIndexOf("_") + 1);
        for (let index = 1; index < 10; index++) {
          if (index > Number(id)) {
            $("#Sys_Backlight_" + index).css("background", "#484c51");
          } else {
            $("#Sys_Backlight_" + index).css("background", "#b0b8cc");
          }
        }
        let value = Number(id) * 11.11;
        let data = {};
        data["sys_backlight"] = value;
        sendMessage(JSON.stringify(data));
      }
    });
    $("#Sys_LoginSet").click(function () {
      $("#login_dialog").css("display", "flex");
    });
    $("#cancelBtn").click(function () {
      $("#login_dialog").css("display", "none");
    });
    $("#submitBtn").click(function () {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      if (!username || !password || !confirmPassword) {
        // alert("请填写所有信息");
        toast({
          title: languageMapTemplate[0][language],
          message: languageMapTemplate[27][language],
          type: "error",
          duration: 2000,
        });
        return;
      }

      if (password !== confirmPassword) {
        // alert("两次密码不一致");
        toast({
          title: languageMapTemplate[0][language],
          message: languageMapTemplate[28][language],
          type: "error",
          duration: 2000,
        });
        return;
      }

      // 提交逻辑（这里打印一下）

      console.log("用户名：", username);
      console.log("密码：", password);
      let data = {};
      data["save_password"] = username + "," + password;
      sendMessage(JSON.stringify(data));

      // alert("密码保存成功！");
      toast({
        title: languageMapTemplate[0][language],
        message: languageMapTemplate[29][language],
        type: "success",
        duration: 2000,
      });
      $("#login_dialog").css("display", "none");
    });

    $("#btn_effect").click(function () {
      const body = document.body;
      body.classList.add("body-overflow-hidden");
      $("#dialog_effect").toggleClass("dialog_active");
      $(".dialog_box").toggleClass("dialog_box_active");
    });

    $(".dialog_box").click(function () {
      const body = document.body;
      body.classList.remove("body-overflow-hidden");
      if ($("#dialog_effect").css("display") !== "none") {
        $(".dialog_box").toggleClass("dialog_box_active");
        $("#dialog_effect").toggleClass("dialog_active");
      }
    });

    //switch开关
    $("#media_window input[type=checkbox]").change(function () {
      $("#media_video .media_item div").css("color", "");
      $("#media_ndi .media_item div").css("color", "");
      $("#pull_stream .media_item div").css("color", "");
      if (this.checked) {
        let data = {};
        media_type = Number(this.id.substring(this.id.lastIndexOf("_") + 1));
        data["media_type"] = media_type;
        sendMessage(JSON.stringify(data));
        let index = Number(cur_sel[media_type]);
        setTimeout(function () {
          data = {};
          data["cur_sel"] = index;
          sendMessage(JSON.stringify(data));
        }, 200);
        setTimeout(function () {
          data = {};
          data["start_play"] = 1;
          sendMessage(JSON.stringify(data));
        }, 400);
      }
    });

    $("#multiview_window input[type=checkbox]").change(function () {
      if (this.checked) {
        $(this)
          .siblings("span")
          .css("background-color", "var(--item-hover-bg)");
      } else {
        $(this).siblings("span").css("background-color", "var(--item-bg)");
      }
      if (this.id === "multiview_audio") {
        if (this.checked) {
          $("#multiview_window button[id^='multiview_audio_']").each(function (
            index,
            element
          ) {
            element.classList.add("active-blue");
            element.value = 1;
            $(element).children("img").attr("src", "./image/sound_sel.png");
            $(element).css("pointer-events", "auto").css("opacity", "1");
          });
        } else {
          $("#multiview_window button[id^='multiview_audio_']").each(function (
            index,
            element
          ) {
            element.classList.remove("active-blue");
            element.value = 0;
            $(element).children("img").attr("src", "./image/sound.png");
            $(element).css("pointer-events", "none").css("opacity", "0.5");
          });
        }
      } else if (this.id === "multiview_source") {
        if (this.checked) {
          $("#multiview_window button[id^='multiview_display_']").each(
            function (index, element) {
              element.classList.add("active-blue");
              element.value = 1;
              $(element).css("pointer-events", "auto").css("opacity", "1");
            }
          );
          $("#multiview_window input[name='multiview_label']")
            .css("pointer-events", "auto")
            .css("opacity", "1");
          $("#multiview_trans")
            .css("pointer-events", "auto")
            .css("opacity", "1");
          umd_sig = { umd_sig1: 1, umd_sig2: 1, umd_sig3: 1, umd_sig4: 1 };
        } else {
          $("#multiview_window button[id^='multiview_display_']").each(
            function (index, element) {
              element.classList.remove("active-blue");
              element.value = 0;
              $(element).css("pointer-events", "none").css("opacity", "0.5");
            }
          );
          $("#multiview_window input[name='multiview_label']")
            .css("pointer-events", "none")
            .css("opacity", "0.5");
          $("#multiview_trans")
            .css("pointer-events", "none")
            .css("opacity", "0.5");
          umd_sig = { umd_sig1: 0, umd_sig2: 0, umd_sig3: 0, umd_sig4: 0 };
        }
      }
      $("#multiview_save").click();
    });

    $("#audio_window input[type=checkbox]").change(function () {
      let data = {};
      data[this.id] = this.checked ? 1 : 0;
      sendMessage(JSON.stringify(data));
    });

    //单选框
    $("input[type=radio]").change(function () {
      let data = {};
      let index = this.id.substring(this.id.lastIndexOf("_") + 1);
      if (index) {
        if (this.name === "Time_Format") {
          clearInterval(timeInterval);
          timeInterval = setInterval(function () {
            $("#sys_time").html(getTime(Number(index)));
          }, 1000);
          data["time_format"] = Number(index);
        } else if (this.name === "Sys_Fan") {
          data["sys_fan"] = Number(index);
        } else if (this.name === "Storage") {
          data["video_path"] = Number(index);
        } else if (
          this.id === "stream-type1-1" ||
          this.id === "stream-type2-1"
        ) {
          $("#stream-" + this.id[11] + "-server").prop("disabled", false);
        } else if (
          this.id === "stream-type1-2" ||
          this.id === "stream-type2-2"
        ) {
          let streamServer = $("#stream-" + this.id[11] + "-server");
          streamServer.val("rtmp://" + hostname + ":1935/live/");
          streamServer.prop("disabled", true);
        } else if (this.name === "Storage") {
          data["video_path"] = Number(index);
        } else if (this.name === "gfx_image") {
          let index = this.id.substring(this.id.lastIndexOf("_") + 1);
          $("#image_list_" + gfxImageType).hide();
          $("#image_list_" + index).show();
          gfxImageType = Number(index);
        } else if (this.name === "Net_Dhcp") {
          let value = Number(this.id.substring(this.id.lastIndexOf("_") + 1));
          for (let index = 1; index < 13; index++) {
            $("#Net_Manual-" + index).css(
              "color",
              value === 1 ? "var(--font-item-color)" : "white"
            );
          }
          $("#Net_IP").css("pointer-events", value === 1 ? "none" : "auto");
          $("#Net_Mask").css("pointer-events", value === 1 ? "none" : "auto");
          $("#Net_Gate").css("pointer-events", value === 1 ? "none" : "auto");
        }

        if (Object.keys(data).length > 0) {
          sendMessage(JSON.stringify(data));
        }
      }
    });

    $("#multiview_window button").click(function () {
      let key = this.id;
      if (key.startsWith("multiview_display_")) {
        let data = {};
        this.classList.toggle("active-blue");
        this.value = this.classList.contains("active-blue") ? 1 : 0;
        let umdItem = {};
        let name = key.substring(key.lastIndexOf("_") + 1);
        if (this.value == "1") {
          $("#multiview_window input[id='multiview_label_" + name + "']")
            .css("pointer-events", "auto")
            .css("opacity", "1");
        } else {
          // let allOff = true;
          // $("#multiview_window button[id^='multiview_display_']").each(function (index, element) {
          //     if (element.value == "1") {
          //         allOff = false;
          //     }
          // });
          // if (allOff) {
          //     $("#multiview_source").prop("checked", false).siblings("span").css("background-color", "var(--item-bg)");
          // }
          $("#multiview_window input[id='multiview_label_" + name + "']")
            .css("pointer-events", "none")
            .css("opacity", "0.5");
        }
        umdItem["umd_" + name] = {
          text: $("#multiview_label_" + name).val(),
          display: Number(this.value),
          audio: Number($("#multiview_audio_" + name).val()),
        };
        data["umd"] = umdItem;
        sendMessage(JSON.stringify(data));
      } else if (key.startsWith("multiview_audio_")) {
        this.classList.toggle("active-blue");
        this.value = this.classList.contains("active-blue") ? 1 : 0;
        $(this)
          .children("img")
          .attr(
            "src",
            this.value === "1" ? "./image/sound_sel.png" : "./image/sound.png"
          );
        let name = key.substring(key.lastIndexOf("_") + 1);
        // let allOff = true;
        // $("#multiview_window button[id^='multiview_audio_']").each(function (index, element) {
        //     if (element.value == "1") {
        //         allOff = false;
        //     }
        // });
        // if (allOff) {
        //     $("#multiview_audio").prop("checked", false).siblings("span").css("background-color", "var(--item-bg)");
        // }
        let umdItem = {};
        umdItem["umd_" + name] = {
          text: $("#multiview_label_" + name).val(),
          display: Number($("#multiview_display_" + name).val()),
          audio: Number(this.value),
        };
        let data = {};
        data["umd"] = umdItem;
        sendMessage(JSON.stringify(data));
      } else if (key === "multiview_trans") {
        this.value = this.value === "0" ? "1" : "0";
        let a = $("#multiview_item_pvw");
        let b = $("#multiview_item_pgm");
        //swap a and b
        let order = a.css("order");
        a.css("order", b.css("order"));
        b.css("order", order);
        let data = {};
        data["to_switch_pvw_pgm"] = Number($("#multiview_trans").val());
        sendMessage(JSON.stringify(data));
      } else if (key === "multiview_reset") {
        $("#multiview_window input[name='multiview_label']").each(function (
          index,
          element
        ) {
          element.value = element.defaultValue;
        });
        // $("#multiview_window button[id^='multiview_display_']").each(function (index, element) {
        //     element.classList.add("active-blue");
        //     element.value = 1;
        // });
        // $("#multiview_window button[id^='multiview_audio_']").each(function (index, element) {
        //     element.classList.add("active-blue");
        //     element.value = 1;
        //     $(element).children("img").attr("src", "./image/sound_sel.png");
        // });
        $("#multiview_window input[type=checkbox]")
          .prop("checked", true)
          .trigger("change");
      } else if (key === "multiview_save") {
        let data = {};
        data["to_switch_pvw_pgm"] = Number($("#multiview_trans").val());
        data["umd_source_disable"] = $("#multiview_source").prop("checked")
          ? 0
          : 1;
        data["umd_audio_disable"] = $("#multiview_audio").prop("checked")
          ? 0
          : 1;
        // data["umd_pvw"] = {"text": $("#multiview_label_pst").val(),
        //     "display": Number($("#multiview_display_pst").val()),
        //     "audio": Number($("#multiview_audio_pst").val())};
        let umdItem = {};
        umdName.forEach(function (item, index) {
          umdItem["umd_" + item] = {
            text: $("#multiview_label_" + item).val(),
            display: Number($("#multiview_display_" + item).val()),
            audio: Number($("#multiview_audio_" + item).val()),
          };
        });
        umdItem["umd_sig1"] = Number(umd_sig["umd_sig1"]);
        umdItem["umd_sig2"] = Number(umd_sig["umd_sig2"]);
        umdItem["umd_sig3"] = Number(umd_sig["umd_sig3"]);
        umdItem["umd_sig4"] = Number(umd_sig["umd_sig4"]);
        data["umd"] = umdItem;
        sendMessage(JSON.stringify(data));
      }
    });

    //layout_window按钮
    $("#layout_window button").click(function () {
      let key = this.id;
      let data = {};
      data[key] = 1;
      sendMessage(JSON.stringify(data));
    });

    //media_window按钮
    $("#media_window button").click(function () {
      let key = this.id;
      let data = {};
      if (key === "pull_stream_apply") {
        let stream = $("#pull_stream_search_input").val();
        let list_str = "";
        pullStreamList.push(stream);
        pullStreamList.forEach(function (item, index) {
          let textColor = $(
            "#pull_stream .media_item :contains(" + item + ")"
          ).css("color");
          list_str +=
            '<div class="media_item rw_item" id="pullstream_' +
            index +
            '"><div style="width: calc(100% - 25px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ' +
            textColor +
            ';" title="' +
            item +
            '">' +
            (index + 1) +
            ". " +
            item +
            '</div><img alt="" src="./image/delete-1.png" style="width: 25px; height: 25px; cursor: pointer;"></div>';
        });
        $("#stream_list").html(list_str);
        data["pullstream_list"] = pullStreamList;
        $("#pull_stream .search_box img").click();
      }
      sendMessage(JSON.stringify(data));
    });

    //system_window按钮
    $("#system_window button").click(function () {
      let key = this.id;
      let param = this.getAttribute("param");
      let color = param ? param : "white";
      let value = this.value === 0 || !this.value ? 1 : 0;
      this.value = value;
      // this.classList.add(LedStatus[value] + "-" + color);
      // Send Json object to server
      let data = {};
      if (key === "stream-1") {
        data["stream-1-server"] = $("#stream-1-server").val();
        data["stream-1-key"] = $("#stream-1-key").val();
        data["stream_fps_index"] = Number($("#fps-1").val());
        data["stream_bitrate"] = Number($("#bitrate-1").val());
      } else if (key === "stream-2") {
        data["stream-2-server"] = $("#stream-2-server").val();
        data["stream-2-key"] = $("#stream-2-key").val();
        data["stream_fps_index"] = Number($("#fps-2").val());
        data["stream_bitrate"] = Number($("#bitrate-2").val());
      } else if (key === "stream-start-1" || key === "stream-start-2") {
        data["stream"] = 1;
      } else if (key === "sdcard-space") {
        data["record-path-first"] = 0;
      } else if (key === "udisk-space") {
        data["record-path-first"] = 1;
      } else if (key === "net_apply") {
        dialog(
          {
            title: "Apply Network Settings",
            message:
              "Are you sure to apply network settings?<br>Reload the page to new ip address after applying.",
          },
          (success) => {
            if ($("#Net_Dhcp_1").prop("checked")) {
              data["sys_dhcp"] = 1;
            } else {
              data["sys_ip"] =
                $("#Net_Manual-1").val() +
                "." +
                $("#Net_Manual-2").val() +
                "." +
                $("#Net_Manual-3").val() +
                "." +
                $("#Net_Manual-4").val();
              data["sys_netmask"] =
                $("#Net_Manual-5").val() +
                "." +
                $("#Net_Manual-6").val() +
                "." +
                $("#Net_Manual-7").val() +
                "." +
                $("#Net_Manual-8").val();
              data["sys_gateway"] =
                $("#Net_Manual-9").val() +
                "." +
                $("#Net_Manual-10").val() +
                "." +
                $("#Net_Manual-11").val() +
                "." +
                $("#Net_Manual-12").val();
              setTimeout(function () {
                let msg = {};
                msg["sys_dhcp"] = 0;
                sendMessage(JSON.stringify(msg));
              }, 200);
            }
            sendMessage(JSON.stringify(data));
          },
          (cancel) => {
            console.log("cancel");
          }
        );
      } else {
        data[key] = value;
      }

      sendMessage(JSON.stringify(data));
    });

    //推杆
    $("#putter").on("input propertychange", (e) => {
      let value = Number(e.currentTarget.value);
      let data = {};
      data["putter"] = value;
      sendMessage(JSON.stringify(data));
    });

    //滑动条
    let range_input = $("input[type=range]");
    range_input.on("touchmove", function () {
      document.body.style.overflow = "hidden";
    });
    range_input.on("touchend", function () {
      document.body.style.overflow = "visible";
    });
    range_input.on("input propertychange", (e) => {
      let target = e.currentTarget;
      $("input[name=" + target.name + "][type='number']").val(
        Number(target.value)
      );
    });
    range_input.change(function () {
      $("input[name=" + this.name + "][type='number']").val(Number(this.value));
      if (!remoteSync) {
        let data = {};
        data[this.id] = Number(this.value);
        sendMessage(JSON.stringify(data));
      }
    });

    //数字输入框
    $("input[type=number]").change(function () {
      let range = $("input[name=" + this.name + "][type='range']");
      if (range) {
        range.val(Number(this.value));
        range.attr("value", Number(this.value));
        range.change();
      }
      let color = $("input[name=" + this.name + "][type='color']");
      if (color) {
        let r = Number($("#" + this.name + "-r").val());
        let g = Number($("#" + this.name + "-g").val());
        let b = Number($("#" + this.name + "-b").val());
        let rgb = "rgb(" + r + "," + g + "," + b + ")";
        color.val(rgb.colorHex());
        color.change();
      }
    });

    $(".mw_audio_item input[type=text]").click(function () {
      let index = this.value;
      if (this.name === "audio_source") {
        index = (sourceArr.indexOf($(this).val()) + 1) % sourceArr.length;
        this.value = sourceArr[index];
      } else if (this.name === "audio_mode") {
        index = (modeArr.indexOf($(this).val()) + 1) % modeArr.length;
        this.value = modeArr[index];
      } else if (this.name === "audio_mic_mode") {
        index = (micModeArr.indexOf($(this).val()) + 1) % micModeArr.length;
        this.value = micModeArr[index];
      }
      let data = {};
      data[this.id] = index;
      sendMessage(JSON.stringify(data));
    });

    //颜色选择器
    $("input[type=color]").change(function () {
      let value = $(this).val();
      let rgb = value.colorRgb();
      let name = $(this).attr("name");
      $("#" + name + "-r").val(rgb[0]);
      $("#" + name + "-g").val(rgb[1]);
      $("#" + name + "-b").val(rgb[2]);
      let data = {};
      data["dip_color"] = value.colorHex();
      sendMessage(JSON.stringify(data));
    });

    function selectVideo(element) {
      clearInterval(clickInterval);
      $("#media_video .media_item").removeClass("media_item_selected");
      $("#media_ndi .media_item div").css("color", "");
      $("#pull_stream .media_item div").css("color", "");
      $("#web_cam .media_item div").css("color", "");
      element.classList.add("media_item_selected");
      // this.children[0].style.color = "green";
      $("#media_video .media_item img").hide();
      $(element).find("img").show();
      $("input[id^='switch_']").prop("checked", false);
      $("#switch_0").prop("checked", true);
      let data = {};
      data["media_type"] = 0;
      sendMessage(JSON.stringify(data));
      let index = element.id.substring(element.id.lastIndexOf("_") + 1);
      setTimeout(function () {
        data = {};
        data["cur_sel"] = Number(index);
        cur_sel[0] = data["cur_sel"];
        sendMessage(JSON.stringify(data));
      }, 200);
    }
    function startPlay() {
      setTimeout(function () {
        let data = {};
        data["start_play"] = 1;
        sendMessage(JSON.stringify(data));
      }, 400);
    }
    // $("#media_video .media_item").click(function () {
    $("#media_video").on("click", ".media_item", function () {
      clearInterval(clickInterval);
      clickInterval = setInterval(() => selectVideo(this), 400);
    });
    // $("#media_video .media_item").dblclick(function () {
    $("#media_video").on("dblclick", ".media_item", function () {
      selectVideo(this);
      startPlay();
    });
    $("#media_video").on("click", ".media_item img", function () {
      selectVideo(this.parentElement);
      startPlay();
    });

    function selectNdi(element) {
      clearInterval(clickInterval);
      $("#media_ndi .media_item").removeClass("media_item_selected");
      $("#media_video .media_item div").css("color", "");
      $("#pull_stream .media_item div").css("color", "");
      $("#web_cam .media_item div").css("color", "");
      element.classList.add("media_item_selected");
      // element.children[0].style.color = "green";
      $("input[id^='switch_']").prop("checked", false);
      $("#switch_1").prop("checked", true);
      let data = {};
      data["media_type"] = 1;
      sendMessage(JSON.stringify(data));
      let index = element.id.substring(element.id.lastIndexOf("_") + 1);
      setTimeout(function () {
        data = {};
        data["cur_sel"] = Number(index);
        cur_sel[1] = data["cur_sel"];
        sendMessage(JSON.stringify(data));
      }, 200);
    }
    // $("#media_ndi .media_item").click(function () {
    $("#media_ndi").on("click", ".media_item", function () {
      clearInterval(clickInterval);
      clickInterval = setInterval(() => selectNdi(this), 400);
    });
    $("#media_ndi").on("dblclick", ".media_item", function () {
      selectNdi(this);
      startPlay();
    });

    function selectPullStream(element) {
      clearInterval(clickInterval);
      $("#pull_stream .media_item").removeClass("media_item_selected");
      $("#media_video .media_item div").css("color", "");
      $("#media_ndi .media_item div").css("color", "");
      $("#web_cam .media_item div").css("color", "");
      element.classList.add("media_item_selected");
      // this.color = "green";
      $("#pull_stream .media_item img").attr("src", "./image/delete-1.png");
      $(element).find("img")[0].src = "./image/delete-2.png";
      $("input[id^='switch_']").prop("checked", false);
      $("#switch_3").prop("checked", true);
      let data = {};
      data["media_type"] = 3;
      sendMessage(JSON.stringify(data));
      let index = element.id.substring(element.id.lastIndexOf("_") + 1);
      setTimeout(function () {
        data = {};
        data["cur_sel"] = Number(index);
        cur_sel[3] = data["cur_sel"];
        sendMessage(JSON.stringify(data));
      }, 200);
    }
    // $("#pull_stream .media_item").click(function () {
    $("#pull_stream").on("click", ".media_item", function () {
      clearInterval(clickInterval);
      clickInterval = setInterval(() => selectPullStream(this), 400);
    });
    $("#pull_stream").on("dblclick", ".media_item", function () {
      selectPullStream(this);
      startPlay();
    });
    $("#pull_stream").on("click", ".media_item img", function () {
      let index = this.parentElement.id.substring(
        this.parentElement.id.lastIndexOf("_") + 1
      );
      pullStreamList.splice(Number(index), 1);
      let list_str = "";
      pullStreamList.forEach(function (item, index) {
        let textColor = $(
          "#pull_stream .media_item :contains(" + item + ")"
        ).css("color");
        list_str +=
          '<div class="media_item rw_item" id="pullstream_' +
          index +
          '"><div style="width: calc(100% - 25px);overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ' +
          textColor +
          ';">' +
          (index + 1) +
          ". " +
          item +
          '</div><img alt="" src="./image/delete-1.png" style="width: 25px; height: 25px; cursor: pointer;"></div>';
      });
      $("#stream_list").html(list_str);
      let data = {};
      data["pullstream_list"] = pullStreamList;
      sendMessage(JSON.stringify(data));
    });

    function selectWebCam(element) {
      clearInterval(clickInterval);
      $("#web_cam .media_item").removeClass("media_item_selected");
      $("#media_video .media_item div").css("color", "");
      $("#pull_stream .media_item div").css("color", "");
      $("#media_ndi .media_item div").css("color", "");
      element.classList.add("media_item_selected");
      // element.children[0].style.color = "green";
      $("input[id^='switch_']").prop("checked", false);
      $("#switch_2").prop("checked", true);
      let data = {};
      data["media_type"] = 2;
      sendMessage(JSON.stringify(data));
      let index = element.id.substring(element.id.lastIndexOf("_") + 1);
      setTimeout(function () {
        data = {};
        data["cur_sel"] = Number(index);
        cur_sel[2] = data["cur_sel"];
        sendMessage(JSON.stringify(data));
      }, 200);
    }
    $("#web_cam").on("click", ".media_item", function () {
      clearInterval(clickInterval);
      clickInterval = setInterval(() => selectWebCam(this), 400);
    });
    $("#web_cam").on("dblclick", ".media_item", function () {
      selectWebCam(this);
      startPlay();
    });

    $("#media_ndi .search_box").click(function () {
      let ndiListBox = $("#ndi_list_box");
      if (ndiListBox.is(":visible")) {
        $(this).find("img")[1].src = "./image/down-arrow.png";
        ndiListBox.hide();
        $("#media_ndi").height(108);
        $("#pull_stream").show();
        if ($("#stream_list_box").is(":visible")) {
          $("#web_cam").hide();
        }
      } else {
        $("#media_ndi").height(304);
        $(this).find("img")[1].src = "./image/up-arrow.png";
        $("#pull_stream").hide();
        ndiListBox.show();
        $("#web_cam").show();
      }
    });
    $("#pull_stream .search_box img").click(function () {
      let streamListBox = $("#stream_list_box");
      if (streamListBox.is(":visible")) {
        $(this).src = "./image/down-arrow.png";
        streamListBox.hide();
        $("#pull_stream").height(158);
        $("#pull_stream_apply").show();
        $("#web_cam").show();
      } else {
        $("#pull_stream_apply").hide();
        $("#pull_stream").height(300);
        $(this).src = "./image/up-arrow.png";
        $("#web_cam").hide();
        streamListBox.show();
      }
    });
    $("#web_cam .search_box").click(function () {
      let camListBox = $("#cam_list_box");
      if (camListBox.is(":visible")) {
        $(this).find("img")[1].src = "./image/down-arrow.png";
        camListBox.hide();
        $("#web_cam").height(108);
        $("#pull_stream").show();
      } else {
        $("#web_cam").height(304);
        $(this).find("img")[1].src = "./image/up-arrow.png";
        $("#pull_stream").hide();
        camListBox.show();
      }
    });

    $("#play_loop").click(function () {
      let value = 0;
      if (this.src.includes("cycle")) {
        value = 0;
        this.src = "./image/play-single.png";
      } else {
        value = 1;
        this.src = "./image/play-cycle.png";
      }
      let data = {};
      data["play_loop"] = value;
      sendMessage(JSON.stringify(data));
    });

    $("#play, #last, #next").click(function () {
      let data = {};
      data[this.id] = 1;
      sendMessage(JSON.stringify(data));
    });

    // 时间同步
    $("#Time_Sync").click(function () {
      let data = {};
      data["sys_datetime"] = getDateTimeString();
      sendMessage(JSON.stringify(data));
    });

    // effect
    $(".effect_img img").click(function () {
      let transEffectRec = $("#Trans_Effect_" + effectIdRec);
      transEffectRec.prop("src", transEffectRec[0].src.replace("sel", "nor"));
      this.src = this.src.replace("nor", "sel");
      effectIdRec = this.id.substring(this.id.lastIndexOf("_") + 1);
      let data = {};
      data["trans-effect"] = Number(effectIdRec) + 1;
      sendMessage(JSON.stringify(data));
    });

    // scene
    $(".scene_img img").click(function () {
      let data = {};
      data["scene"] = Number(this.id.substring(this.id.lastIndexOf("_") + 1));
      sendMessage(JSON.stringify(data));
    });

    // custom scene
    $(".scene_img [id^=custom_scene_]").click(function () {
      let data = {};
      let key = $("#scene_save")[0].checked
        ? "save_custom_scene"
        : "load_custom_scene";
      data[key] = Number(this.id.substring(this.id.lastIndexOf("_") + 1));
      sendMessage(JSON.stringify(data));
    });

    // 文件上传
    $("input[type=file]").change(function () {
      if (this.files && this.files[0]) {
        let formData = new FormData();
        formData.append("id", this.id);
        formData.append("filename", this.files[0].name);
        formData.append("file", this.files[0]);
        // submitForm(formData);
        let id = this.id;
        $.ajax({
          url: "/file",
          type: "POST",
          data: formData,
          processData: false,
          contentType: false,
          success: function (data) {
            toast({
              title: "Notice",
              message: "File uploaded successfully",
              type: "success",
              duration: 2000,
            });
            let fileInput = $("#" + id);
            fileInput.siblings().show();
            fileInput.siblings(".spinner-border").hide();
          },
          error: function (data) {
            toast({
              title: "Error",
              message: "Failed to upload file",
              type: "error",
              duration: 2000,
            });
            let fileInput = $("#" + id);
            fileInput.siblings().show();
            fileInput.siblings(".spinner-border").hide();
          },
        });
        $(this).siblings().hide();
        $(this).siblings(".spinner-border").show();
      }
    });

    $("#gfx_logo").change(function (e) {
      if (e.target && e.target.type === "file") {
        let formData = new FormData();
        let file = e.target.files[0];
        let fileName = file.name;
        // if (fileName.isChinese()) {
        //     fileName = encodeURIComponent(fileName);
        // }
        formData.append("filename", fileName);
        formData.append("id", e.target.id);
        formData.append("file", file);
        submitForm(formData);
      }
    });

    $("#gfx_logo").click(function (e) {
      clearInterval(clickInterval);
      clickInterval = setInterval(function () {
        if (e.target && e.target.nodeName === "IMG") {
          let data = {};
          data["apply_image_" + gfxImageType] = Number(
            e.target.id.substring(e.target.id.lastIndexOf("_") + 1)
          );
          sendMessage(JSON.stringify(data));
        }
        clearInterval(clickInterval);
      }, 400);
    });

    $("#gfx_logo").dblclick(function (e) {
      clearInterval(clickInterval);
      if (e.target && e.target.nodeName === "IMG") {
        dialog(
          {
            title: languageMapTemplate[0][language],
            message: languageMapTemplate[23][language],
          },
          (success) => {
            let data = {};
            let deleteInfo = {};
            deleteInfo["type"] = gfxImageType;
            deleteInfo["index"] = Number(
              e.target.id.substring(e.target.id.lastIndexOf("_") + 1)
            );
            deleteInfo["name"] = e.target.src.substring(
              e.target.src.lastIndexOf("/") + 1
            );
            data["delete_image"] = deleteInfo;
            sendMessage(JSON.stringify(data));
          },
          (cancel) => {
            console.log("cancel");
          }
        );
      }
    });
  });

  function submitForm(formData) {
    $.ajax({
      url: "/file",
      type: "POST",
      data: formData,
      processData: false,
      contentType: false,
      success: function (data) {
        toast({
          title: languageMapTemplate[0][language],
          message: languageMapTemplate[24][language],
          type: "success",
          duration: 2000,
        });
      },
      error: function (data) {
        toast({
          title: languageMapTemplate[0][language],
          message: languageMapTemplate[25][language],
          type: "error",
          duration: 2000,
        });
      },
    });
  }

  function initCanvas() {
    fabric.Object.prototype.set({
      cornerStrokeColor: "", //激活状态角落图标的边框颜色
      borderColor: "rgb(113, 120, 134)",
      cornerColor: "rgb(255, 255, 255)",
      cornerStyle: "circle",
      minScaleLimit: 0.0, // 对象允许的最小比例值
      transparentCorners: false, //激活状态角落的图标是否透明
    });
    fabric.Object.prototype.setControlsVisibility({
      // ml: false,
      // mb: false,
      // mr: false,
      // mt: false,
      mtr: false,
    });
    //限制元素放大的倍数
    fabric.Object.prototype.on("scaling", function (e) {
      // console.log(this);
      let id = this.canvas.id;
      //pip 缩放比例 0.5-满屏
      //chroma 缩放大小 20-150
      let pipScale = canvasPipW / this.width;
      let chromaScale = 21 / this.width;
      let mediaScale = 416 / this.width;

      console.log(this.id, e.transform.originX, e.transform.originY);
      if (
        e.transform.originX === "center" &&
        e.transform.originY === "bottom"
      ) {
        cropSide = 0;
      } else if (
        e.transform.originX === "right" &&
        e.transform.originY === "center"
      ) {
        cropSide = 1;
      } else if (
        e.transform.originX === "center" &&
        e.transform.originY === "top"
      ) {
        cropSide = 3;
      } else if (
        e.transform.originX === "left" &&
        e.transform.originY === "center"
      ) {
        cropSide = 2;
      } else {
        cropSide = -1;
      }

      isPipChange = id === "pip";
      isChromaPosChange = id === "chroma";
      var maxScaleX = 0;
      if (id === "pip") {
        maxScaleX = pipScale;
      } else if (id === "chroma") {
        maxScaleX = chromaScale;
      } else if (id === "media") {
        maxScaleX = mediaScale;
      }

      if (this.left < 0) {
        this.left = 0;
      }
      if (this.top < 0) {
        this.top = 0;
      }
      let width = this.width * this.scaleX;
      width = Number(width.toFixed(0));
      let height = this.height * this.scaleY;
      height = Number(height.toFixed(0));

      if (!this.lastGoodscale) {
        this.lastGoodscale = this.scaleX;
      }
      if (!this.lastGoodLeft) {
        this.lastGoodLeft = this.left;
      }
      if (!this.lastGoodTop) {
        this.lastGoodTop = this.top;
      }
      if (
        this.left + width / 2 > this.canvas.width + 2 ||
        this.top + height / 2 > this.canvas.height + 2
      ) {
        this.scaleX = this.lastGoodscale;
        this.scaleY = this.lastGoodscale;
        this.left = this.lastGoodLeft;
        this.top = this.lastGoodTop;
      }

      if (this.scaleX > maxScaleX) {
        this.scaleX = maxScaleX;
        this.scaleY = maxScaleX;
        this.left = this.lastGoodLeft;
        this.top = this.lastGoodTop;
      }
      if (this.scaleX < 0.1) {
        this.scaleX = 0.1;
        this.scaleY = 0.1;
        this.left = this.lastGoodLeft;
        this.top = this.lastGoodTop;
      }

      this.lastGoodTop = this.top;
      this.lastGoodLeft = this.left;
      this.lastGoodscale = this.scaleX;

      // console.log(this.width, this.height, this.scaleX, this.scaleY);
      let size = this.getObjects().find((o) => o.id === this.id + "_size");
      let w = Math.round((this.getBoundingRect().width * 1920.0) / canvasPipW);
      let h = Math.round((this.getBoundingRect().height * 1920.0) / canvasPipH);
      size.set({ text: "SIZE(" + w + "," + h + ")" });
    });

    canvasPip = new fabric.Canvas("canvas-pip", { id: "pip" });
    // canvasChroma = new fabric.Canvas("canvas-chroma", {
    //     id: "chroma",
    // });

    canvasLogo = new fabric.Canvas("canvas-logo", { id: "canvasLogo" });
    // canvasPat = new fabric.Canvas("media_pat", {id: "mediaPat"});
    // 禁止框选
    canvasPip.selection = false;
    // canvasChroma.selection = false;
    canvasLogo.selection = false;
    // canvasPat.selection = false;

    // 阻止对象移动到画布外面
    canvasPip.on("object:moving", (e) => {
      canvasMoving(e.target);
      isPipChange = true;
    });
    canvasPip.on("mouse:down", function (options) {
      if (options.target) {
        fabric.Object.prototype.setControlsVisibility({
          tl: true,
          bl: true,
          tr: true,
          br: true,
          ml: true,
          mb: true,
          mr: true,
          mt: true,
          mtr: false,
        });
        // console.log(options.target.id);
        if (options.target.id === "A" && selectedLayer !== "A") {
          selectedLayer = "A";
          let data = {};
          data["set_1"] = 1;
          sendMessage(JSON.stringify(data));
        } else if (options.target.id === "B" && selectedLayer !== "B") {
          selectedLayer = "B";
          let data = {};
          data["set_2"] = 1;
          sendMessage(JSON.stringify(data));
        }
      }
    });
    canvasPip.on("mouse:up", function (options) {
      if (options.target && isPipChange) {
        let index = options.target.id === "A" ? 1 : 2;
        let data = {};
        let pipLayer = {};
        let wScale = Math.round(
          (options.target.getBoundingRect().width * 100.0) / canvasPipW
        );
        let hScale = Math.round(
          (options.target.getBoundingRect().height * 100.0) / canvasPipH
        );
        let w = Math.floor((1920.0 * wScale) / 100.0);
        let h = Math.floor((1080.0 * hScale) / 100.0);
        pipLayer["pip" + index + "_pos_x"] = Math.round(
          ((options.target.left - options.target.getBoundingRect().width / 2) *
            1920.0) /
          canvasPipW
        );
        pipLayer["pip" + index + "_pos_y"] = Math.round(
          ((options.target.top - options.target.getBoundingRect().height / 2) *
            1080.0) /
          canvasPipH
        );
        pipLayer["pip" + index + "_dis_w"] = w % 2 === 1 ? w + 1 : w;
        pipLayer["pip" + index + "_dis_h"] = h;
        pipLayer["pip" + index + "_custom_w"] = wScale;
        pipLayer["pip" + index + "_custom_h"] = hScale;

        let size = options.target
          .getObjects()
          .find((o) => o.id === options.target.id + "_size");
        size.set({
          text:
            "SIZE(" +
            pipLayer["pip" + index + "_dis_w"] +
            "," +
            pipLayer["pip" + index + "_dis_h"] +
            ")",
        });
        isPipChange = false;

        if (cropSide === -1) {
          data["layer_pip_" + index] = pipLayer;
        } else {
          let cropInfo = {};
          cropInfo["side"] = cropSide;
          if (cropSide === 0 || cropSide === 3) {
            cropInfo["dist"] = pipLayer["pip" + index + "_dis_h"];
          } else {
            cropInfo["dist"] = pipLayer["pip" + index + "_dis_w"];
          }
          data["pip_crop_" + index] = cropInfo;
          cropSide = -1;
        }
        sendMessage(JSON.stringify(data));
      }
    });

    canvasLogo.on("mouse:up", function (options) {
      if (options.target && gfxImageType > 0) {
        let data = {};
        let logoPos = {};
        let scale = canvasLogo.width / 1920.0;
        logoPos["logo" + gfxImageType + "_x"] = Math.round(
          options.target.left / scale
        );
        logoPos["logo" + gfxImageType + "_y"] = Math.round(
          options.target.top / scale
        );
        data["pos_logo_" + gfxImageType] = logoPos;
        sendMessage(JSON.stringify(data));
      }
    });

    pst = new fabric.Textbox("PST", {
      width: 40,
      top: 10,
      left: canvasPipW - 50,
      fontSize: 18,
      fontWeight: "bold",
      textAlign: "center",
      fill: "#fff",
      backgroundColor: "#00751e",

      selectable: false, //禁止选中当前元素
      hasBorders: false, //不显示选中时的边
      hasControls: false, //不显示控制的那9个按钮
    });

    pgm = new fabric.Textbox("PGM", {
      width: 40,
      top: 10,
      left: canvasPipW - 50,
      fontSize: 18,
      fontWeight: "bold",
      textAlign: "center",
      fill: "#fff",
      backgroundColor: "#ce0000",

      selectable: false, //禁止选中当前元素
      hasBorders: false, //不显示选中时的边
      hasControls: false, //不显示控制的那9个按钮
    });
    // canvasChroma.on("object:moving", (e) => {
    //     canvasMoving(e.target);
    //     isChromaPosChange = true;
    // });
    // canvasChroma.on("mouse:down", function (options) {
    //     if (options.target) {
    //         fabric.Object.prototype.setControlsVisibility({
    //             tl: false,
    //             bl: false,
    //             tr: false,
    //             br: true,
    //             mb: false,
    //             mr: false,
    //             ml: false,
    //             mt: false,
    //             mtr: false,
    //         });
    //     }
    // });
    // canvasChroma.on("mouse:up", function (options) {
    //     if (options.target && isChromaPosChange) {
    //         // console.log(options);
    //         var objects = canvasChroma.getObjects();
    //         // console.log(objects[0]);
    //         //1080*1920
    //         //153*272
    //         //7.059
    //         var array = [];
    //         var element = objects[0];
    //         array[0] = Math.round((element.left / 272.0) * 1920.0);
    //         if (array[0] < 0) {
    //             array[0] = 0;
    //         }
    //         // console.log(element.top);
    //         // console.log((element.top / 153.0) * 1080.0);
    //         array[1] = Math.round((element.top / 153.0) * 1080.0);
    //         if (array[1] < 0) {
    //             array[1] = 0;
    //         }
    //         //width 和 height 会比创建时多 1
    //         array[2] = Math.round(
    //             ((element.getBoundingRect().width - 1) / 272.0) * 1920.0
    //         );
    //         if (array[2] > 150) {
    //             array[2] = 150;
    //         }
    //         if (array[2] < 20) {
    //             array[2] = 20;
    //         }
    //         // array[3] = Math.round(
    //         //   ((element.getBoundingRect().height - 1) / 153.0) * 1080.0
    //         // );
    //         // console.log(array);
    //         var str = "";
    //         for (let index = 0; index < array.length; index++) {
    //             const element = array[index];
    //             str += element + ",";
    //         }
    //         str = str.substring(0, str.length - 1);
    //         //TODO: send message
    //
    //         isChromaPosChange = false;
    //     }
    // });
    canvasLogo.on("object:moving", (e) => {
      canvasMoving(e.target);
    });
    // canvasPat.on("object:moving", (e) => {
    //     canvasMoving(e.target);
    // });

    // addPstRect(1);
    addCanvasRect({
      left: 480,
      top: 540,
      width: 960,
      height: 540,
      textValue: "A",
    });
    addCanvasRect({
      left: 1440,
      top: 540,
      width: 960,
      height: 540,
      textValue: "B",
    });

    let logo1 = new fabric.Image.fromURL("./image/search.png", function (img) {
      img.set({
        id: "logo_1",
        left: 0,
        top: 0,
        angle: 0,
        opacity: 1,
        hasControls: false, //不显示控制的那9个按钮
      });
      canvasLogo.add(img);
    });
    let logo2 = new fabric.Image.fromURL("./image/search.png", function (img) {
      img.set({
        id: "logo_2",
        left: 0,
        top: 0,
        angle: 0,
        opacity: 1,
        hasControls: false, //不显示控制的那9个按钮
      });
      canvasLogo.add(img);
    });
  }

  function canvasMoving(obj) {
    // console.log(obj);
    let padding = 0; // 内容距离画布的空白宽度，主动设置
    let overHeight = Math.round(obj.getBoundingRect().height * 0.9);
    let overWeight = Math.round(obj.getBoundingRect().width * 0.9);
    if (
      obj.id === "chroma" ||
      obj.id === "mediaLogo" ||
      obj.id === "mediaPat"
    ) {
      overHeight = overWeight = 0;
    }
    if (
      obj.currentHeight > obj.canvas.height - padding * 2 ||
      obj.currentWidth > obj.canvas.width - padding * 2
    ) {
      return;
    }
    obj.setCoords();
    if (regionMaskOn) {
      if (
        obj.getBoundingRect().top < padding - overHeight ||
        obj.getBoundingRect().left < padding - overWeight
      ) {
        obj.top = Math.max(
          obj.top,
          obj.top - obj.getBoundingRect().top + padding - overHeight
        );
        obj.left = Math.max(
          obj.left,
          obj.left - obj.getBoundingRect().left + padding - overWeight
        );
      }
    } else {
      if (
        obj.getBoundingRect().top < padding ||
        obj.getBoundingRect().left < padding
      ) {
        obj.top = Math.max(
          obj.top,
          obj.top - obj.getBoundingRect().top + padding
        );
        obj.left = Math.max(
          obj.left,
          obj.left - obj.getBoundingRect().left + padding
        );
      }
    }
    if (
      obj.getBoundingRect().top + obj.getBoundingRect().height >
      obj.canvas.height - padding + overHeight ||
      obj.getBoundingRect().left + obj.getBoundingRect().width >
      obj.canvas.width - padding + overWeight
    ) {
      obj.top = Math.min(
        obj.top,
        obj.canvas.height -
        obj.getBoundingRect().height +
        obj.top -
        obj.getBoundingRect().top -
        padding +
        overHeight
      );
      obj.left = Math.min(
        obj.left,
        obj.canvas.width -
        obj.getBoundingRect().width +
        obj.left -
        obj.getBoundingRect().left -
        padding +
        overWeight
      );
    }

    if (obj.id === "A" || obj.id === "B") {
      let pos = obj.getObjects().find((o) => o.id === obj.id + "_pos");
      pos.set({
        text:
          "POS(" +
          Math.round(
            ((obj.left - obj.getBoundingRect().width / 2) * 1920.0) / canvasPipW
          ) +
          "," +
          Math.round(
            ((obj.top - obj.getBoundingRect().height / 2) * 1080.0) / canvasPipH
          ) +
          ")",
      });
    }
  }
}, 1000);
