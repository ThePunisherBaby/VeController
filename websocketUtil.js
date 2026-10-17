let websocket = null;
let hostname = document.location.hostname;
let wsUri = "ws://" + hostname + ":8089";
let defaultStreamAddress = [];
let pullStreamList = [];
let configFile = [];
let configFileName = "";
let configFileSize = 0;
let receivedFileSize = 0;

const ReadyState = {
  0: "CONNECTING",
  1: "OPEN",
  2: "CLOSING",
  3: "CLOSED",
  4: "UNKNOWN",
};
const LedStatus = { 0: "none", 1: "active", 2: "flash" };
const imageListDir = {
  0: "/gfx_images/",
  1: "/gfx_logos/",
  2: "/gfx_text_logos/",
};

function initWebSocket() {
  try {
    if (websocket) {
      if (websocket.readyState === 1) {
        websocket.close();
      } else if (websocket.readyState !== 3) {
        console.log("checkSocket :", ReadyState[websocket.readyState]);
        return;
      }
    }

    websocket = new WebSocket(wsUri);
    websocket.binaryType = "arraybuffer";

    websocket.onopen = function (evt) {
      isConnect = true;
      console.log("Message received : CONNECTED", evt);
    };

    websocket.onclose = function (evt) {
      isConnect = false;
      console.log("Message received : DISCONNECTED", evt);
    };

    websocket.onmessage = function (evt) {
      console.log("Message received :", evt);
      if (evt.data instanceof ArrayBuffer) {
        receivedFileSize += evt.data.byteLength;
        configFile.push(new Uint8Array(evt.data));
        return;
      }
      try {
        const msg = JSON.parse(evt.data);
        handleResult(msg);
      } catch (e) {
        console.error("Invalid message:", evt.data);
      }
    };

    websocket.onerror = function (evt) {
      console.log("Message error :", evt.data);
    };
  } catch (exception) { }
}

function sendMessage(msg) {
  if (websocket != null && !remoteSync) {
    websocket.send(msg);
    console.log("websocket sent :", msg);
  }
}

function handleResult(data) {
  console.log(data);
  if (!data) {
    console.log("data is empty");
    return;
  }
  isConnect = true;
  remoteSync = true;
  let element;
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key || data[key] == null) {
      console.log("key or value is empty");
    } else if (key === "file_start") {
      exporting = true;
      configFileName = data[key];
      configFile = [];
      configFileSize = 0;
    } else if (key === "file_end") {
      exporting = false;
      configFileSize = data[key];
      if (configFileSize === receivedFileSize) {
        receivedFileSize = 0;
        const blob = new Blob(configFile, { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = configFileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else if (key === "udisk-space" || key === "sdcard-space") {
      $("#space_total").text(data[key].split("/")[1] + "GB");
      $("#space_used").text(data[key].split("/")[0] + "GB Used");
      let percent = 0;
      if (data[key].split("/")[1] !== "0.0") {
        percent = (data[key].split("/")[0] / data[key].split("/")[1]) * 100;
      }
      $("#space_bar").css("background-size", percent + "% 100%");
    } else if (key === "stream_fps_index") {
      $("#fps-1").val(data[key]);
      $("#fps-2").val(data[key]);
    } else if (key === "stream_bitrate") {
      $("#bitrate-1").val(data[key]);
      $("#bitrate-2").val(data[key]);
    } else if (key === "record_time") {
      $("#record_time").text(data[key]);
      $("#rec_time").text(data[key]);
    } else if (key === "remain_time") {
      $("#remain_time").text(data[key]);
    } else if (key === "stream_time") {
      $("#stream_time").text(data[key]);
    } else if (key === "sys_time_format") {
      $("#Time_Format_" + data[key]).prop("checked", true);
      // clearInterval(timeInterval);
      // timeInterval = setInterval(function () {
      //     $("#sys_time").html(getTime(Number(data[key])));
      // }, 1000);
    } else if (key === "sys_backlight") {
      for (let index = 1; index < 10; index++) {
        let value = Number(data[key]) / 11.11;
        value = value.toFixed(0);
        // console.log(value);
        if (index > Number(value)) {
          $("#Sys_Backlight_" + index).css("background", "#484c51");
        } else {
          $("#Sys_Backlight_" + index).css("background", "#b0b8cc");
        }
      }
    } else if (key === "sys_fan") {
      $("#Sys_Fan_" + data[key]).prop("checked", true);
    } else if (key === "sys_keyledlight") {
    } else if (key === "sys_languagelist") {
      regroupLanguageMap(data[key]);
      loadProperties(languageList[language]);
    } else if (key === "sys_dhcp") {
      let value = data[key] ? 1 : 0;
      for (let index = 1; index < 13; index++) {
        $("#Net_Manual-" + index).css(
          "color",
          value === 1 ? "var(--font-item-color)" : "white"
        );
      }
      $("#Net_IP").css("pointer-events", value === 1 ? "none" : "auto");
      $("#Net_Mask").css("pointer-events", value === 1 ? "none" : "auto");
      $("#Net_Gate").css("pointer-events", value === 1 ? "none" : "auto");
    } else if (key === "sys_ip") {
      $("#Net_Manual-1").val(Number(data[key].split(".")[0]));
      $("#Net_Manual-2").val(Number(data[key].split(".")[1]));
      $("#Net_Manual-3").val(Number(data[key].split(".")[2]));
      $("#Net_Manual-4").val(Number(data[key].split(".")[3]));
    } else if (key === "sys_netmask") {
      $("#Net_Manual-5").val(Number(data[key].split(".")[0]));
      $("#Net_Manual-6").val(Number(data[key].split(".")[1]));
      $("#Net_Manual-7").val(Number(data[key].split(".")[2]));
      $("#Net_Manual-8").val(Number(data[key].split(".")[3]));
    } else if (key === "sys_gateway") {
      $("#Net_Manual-9").val(Number(data[key].split(".")[0]));
      $("#Net_Manual-10").val(Number(data[key].split(".")[1]));
      $("#Net_Manual-11").val(Number(data[key].split(".")[2]));
      $("#Net_Manual-12").val(Number(data[key].split(".")[3]));
    } else if (key === "video_path") {
      // 0=local;1=sdcard;2=usb
      $("#Storage_" + data[key]).prop("checked", true);
    } else if (key === "video_list") {
      let video_list_str = "";
      data[key].forEach(function (item, index) {
        video_list_str +=
          '<div class="media_item rw_item" id="video_' +
          index +
          '"><div style="width: calc(100% - 25px);overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' +
          item +
          '">' +
          (index + 1) +
          "." +
          item +
          '</div><img alt="" src="./image/play-start.png" style="width: 25px; height: 25px; display: none; cursor: pointer;"></div>';
      });
      $("#video_list").html(video_list_str);
    } else if (key === "ndi_list") {
      let list_str = "";
      data[key].forEach(function (item, index) {
        list_str +=
          '<div class="media_item rw_item" id="ndi_' +
          index +
          '"><div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' +
          item +
          '">' +
          (index + 1) +
          ". " +
          item +
          "</div></div>";
      });
      $("#ndi_list").html(list_str);
    } else if (key === "pullstream_list") {
      let list_str = "";
      data[key].forEach(function (item, index) {
        pullStreamList.push(item);
        list_str +=
          '<div class="media_item rw_item" id="pullstream_' +
          index +
          '"><div style="width: calc(100% - 25px);overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' +
          item +
          '">' +
          (index + 1) +
          ". " +
          item +
          '</div><img alt="" src="./image/delete-1.png" style="width: 25px; height: 25px; cursor: pointer;"></div>';
      });
      $("#stream_list").html(list_str);
    } else if (key === "webcam_list") {
      let list_str = "";
      data[key].forEach(function (item, index) {
        list_str +=
          '<div class="media_item rw_item" id="cam_' +
          index +
          '"><div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' +
          item +
          '">' +
          (index + 1) +
          ". " +
          item +
          "</div></div>";
      });
      $("#cam_list").html(list_str);
    } else if (key.startsWith("image_list_")) {
      let type = key.split("_")[2];
      let list_str = "";
      data[key].forEach(function (item, index) {
        list_str +=
          '<img alt="" src="' +
          imageListDir[type] +
          item +
          '" id="' +
          key +
          "_" +
          index +
          '"/>';
      });
      list_str +=
        '<div id="' +
        key +
        '_add" onclick="document.getElementById(\'image_upload_\'+gfxImageType).click();" style="width: 20%; height: 52px; margin: 5px; border-radius: 5px; cursor: pointer;' +
        'background-color: var(--item-bg); border: 1px solid var(--border-color); display: flex; justify-content: center; align-items: center;">' +
        '<img alt="" src="./image/add-circle.png" style="width: 30px; height: 30px;"/>' +
        '<input accept="image/png" id="image_upload_' +
        type +
        '" style="display: none;" type="file"/></div>';
      $("#" + key).html(list_str);
    } else if (key === "play_status") {
      $("#play").prop(
        "src",
        data[key] === 1 ? "./image/play-stop.png" : "./image/play-start2.png"
      );
    } else if (key === "media_type") {
      //0=video;1=ndi;2=webcam;3=pullstream
      $("input[id^='switch_']").prop("checked", false);
      $("#switch_" + data[key]).prop("checked", true);
      media_type = Number(data[key]);
    } else if (key === "play_loop") {
      //0=single;1=cycle
      // $("#play_loop").src = data[key] === 0 ? "./image/play-single.png" : "./image/play-cycle.png";
      $("#play_loop").prop(
        "src",
        data[key] === 0 ? "./image/play-single.png" : "./image/play-cycle.png"
      );
    } else if (key === "stream_status") {
      setTimeout(function () {
        $("#pull_stream .media_item div").css("color", "");
        let item = $(
          "#pull_stream .media_item :contains(" + data[key]["stream_name"] + ")"
        );
        if (item.length > 0 && media_type === 3) {
          if (data[key]["play_status"] === 1) {
            item.css("color", "green");
          } else if (data[key]["play_status"] < 1) {
            item.css("color", "red");
          }
          let id = item.parent().attr("id");
          cur_sel[3] = Number(id.substring(id.lastIndexOf("_") + 1));
        }
      }, 200);
    } else if (key === "ndi_name") {
      setTimeout(function () {
        $("#media_ndi .media_item div").css("color", "");
        let item = $("#media_ndi .media_item :contains(" + data[key] + ")");
        if (item.length > 0 && media_type === 1) {
          item.css("color", "green");
          let id = item.parent().attr("id");
          cur_sel[1] = Number(id.substring(id.lastIndexOf("_") + 1));
        }
      }, 200);
    } else if (key === "video_status") {
      setTimeout(function () {
        $("#media_video .media_item div").css("color", "");
        let item = $(
          "#media_video .media_item :contains(" +
          data[key]["path_video"].split("/").pop() +
          ")"
        );
        if (item.length > 0 && media_type === 0) {
          if (data[key]["play_status"] === 1) {
            item.css("color", "green");
          }
          let id = item.parent().attr("id");
          cur_sel[0] = Number(id.substring(id.lastIndexOf("_") + 1));
        }
      }, 200);
    } else if (key === "webcam_name") {
      setTimeout(function () {
        $("#web_cam .media_item div").css("color", "");
        let item = $("#web_cam .media_item :contains(" + data[key] + ")");
        if (item.length > 0 && media_type === 1) {
          item.css("color", "green");
          let id = item.parent().attr("id");
          cur_sel[2] = Number(id.substring(id.lastIndexOf("_") + 1));
        }
      }, 200);
    } else if (key === "trans-effect") {
      $("#Trans_Effect_" + data[key]).click();
    } else if (key === "custom_scenes") {
      data[key].forEach(function (item, index) {
        if (item === true) {
          $("#custom_scene_" + index).addClass("active-white");
        }
      });
    } else if (key.startsWith("layer_pip_")) {
      let index = key.split("_")[2];
      let id = index === "1" ? "A" : "B";
      let layer = canvasPip.getObjects().find((obj) => obj.id === id);
      if (canvasPip && layer) {
        for (let i = 0; i < layer.getObjects().length; i++) {
          let obj = layer.getObjects()[i];
          // if (obj.id.endsWith("_rect")) {
          //     obj.set({
          //         width: data[key]["pip" + index + "_dis_w"] * canvasPipW / 1920,
          //         height: data[key]["pip" + index + "_dis_h"] * canvasPipH / 1080,
          //     });
          // }
          if (obj.id.endsWith("_pos")) {
            obj.set({
              text:
                "POS(" +
                data[key]["pip" + index + "_pos_x"] +
                "," +
                data[key]["pip" + index + "_pos_y"] +
                ")",
            });
          } else if (obj.id.endsWith("_size")) {
            // let w = data[key]["pip" + index + "_custom_w"] * 1920.0 / 100.0;
            // let h = data[key]["pip" + index + "_custom_h"] * 1080.0 / 100.0;
            obj.set({
              text:
                "SIZE(" +
                data[key]["pip" + index + "_dis_w"] +
                "," +
                data[key]["pip" + index + "_dis_h"] +
                ")",
            });
          }
        }
        let scaleW =
          (data[key]["pip" + index + "_custom_w"] * canvasPipW) / 100.0;
        let scaleH =
          (data[key]["pip" + index + "_custom_h"] * canvasPipH) / 100.0;
        layer.set({
          scaleX: scaleW / layer.width,
          scaleY: scaleH / layer.height,
          left:
            (data[key]["pip" + index + "_pos_x"] * canvasPipW) / 1920.0 +
            scaleW / 2.0,
          top:
            (data[key]["pip" + index + "_pos_y"] * canvasPipH) / 1080.0 +
            scaleH / 2.0,
        });
        layer.setCoords();
        canvasPip.renderAll();
      } else {
        // addCanvasRect({
        //     left: data[key]["pip" + index + "_pos_x"],
        //     top:  data[key]["pip" + index + "_pos_y"],
        //     width: data[key]["pip" + index + "_dis_w"],
        //     height: data[key]["pip" + index + "_dis_h"],
        //     textValue: id
        // });
      }
    } else if (key.startsWith("pos_logo_")) {
      let index = key.split("_")[2];
      let id = "logo_" + index;
      let scale = canvasLogo.width / 1920.0;
      let logo = canvasLogo.getObjects().find((obj) => obj.id === id);
      if (canvasLogo && logo) {
        logo.set({
          left: data[key]["logo" + index + "_x"] * scale,
          top: data[key]["logo" + index + "_y"] * scale,
          scaleX: scale,
          scaleY: scale,
        });
        logo.setCoords();
        canvasLogo.renderAll();
      }
    } else if (key.startsWith("apply_image_")) {
      let type = key.split("_")[2];
      let index = data[key];
      let id = "logo_" + type;
      let logo = canvasLogo.getObjects().find((obj) => obj.id === id);
      if (canvasLogo && logo) {
        let img = document.getElementById("image_list_" + type + "_" + index);
        if (img) {
          logo.setSrc(img.src, function () {
            logo.setCoords();
            canvasLogo.renderAll();
          });
        } else {
          setTimeout(function () {
            logo.setSrc(
              document.getElementById("image_list_" + type + "_" + index).src,
              function () {
                logo.setCoords();
                canvasLogo.renderAll();
              }
            );
          }, 300);
        }
      }
    } else if (key === "umd") {
      Object.keys(data[key]).forEach(function (item_key, index) {
        let item = data[key][item_key];
        let name = item_key.split("_")[1];
        if (item_key.includes("sig")) {
          umd_sig[item_key] = item;
          return;
        }
        let label = $("#multiview_label_" + name);
        if (label.length > 0) {
          label.val(item.text);
        }
        let display = $("#multiview_display_" + name);
        if (display.length > 0) {
          display.val(item.display);
          if (item.display === 1) {
            display.addClass("active-blue");
          } else {
            $("#multiview_window input[id='multiview_label_" + name + "']")
              .css("pointer-events", "none")
              .css("opacity", "0.5");
            display.removeClass("active-blue");
          }
        }
        let audio = $("#multiview_audio_" + name);
        if (audio.length > 0) {
          audio.val(item.audio);
          if (audio.val() === "1") {
            audio.addClass("active-blue");
            audio.children("img").attr("src", "./image/sound_sel.png");
          } else {
            audio.removeClass("active-blue");
            audio.children("img").attr("src", "./image/sound.png");
          }
        }
      });
    } else if (key === "to_switch_pvw_pgm") {
      let multiviewTrans = $("#multiview_trans");
      if (multiviewTrans.length > 0) {
        if (Number(multiviewTrans.val()) !== data[key]) {
          multiviewTrans.val(data[key]);
          let a = $("#multiview_item_pvw");
          let b = $("#multiview_item_pgm");
          //swap a and b
          let order = a.css("order");
          a.css("order", b.css("order"));
          b.css("order", order);
        }
      }
    } else if (key === "umd_source_disable" && data[key] == 1) {
      $("#multiview_source")
        .prop("checked", false)
        .siblings("span")
        .css("background-color", "var(--item-bg)");
      $("#multiview_window button[id^='multiview_display_']").each(function (
        index,
        element
      ) {
        element.classList.remove("active-blue");
        element.value = 0;
        $(element).css("pointer-events", "none").css("opacity", "0.5");
      });
      $("#multiview_window input[name='multiview_label']")
        .css("pointer-events", "none")
        .css("opacity", "0.5");
      $("#multiview_trans").css("pointer-events", "none").css("opacity", "0.5");
      umd_sig = { umd_sig1: 0, umd_sig2: 0, umd_sig3: 0, umd_sig4: 0 };
    } else if (key === "umd_audio_disable" && data[key] == 1) {
      $("#multiview_audio")
        .prop("checked", false)
        .siblings("span")
        .css("background-color", "var(--item-bg)");
      $("#multiview_window button[id^='multiview_audio_']").each(function (
        index,
        element
      ) {
        element.classList.remove("active-blue");
        element.value = 0;
        $(element).children("img").attr("src", "./image/sound.png");
        $(element).css("pointer-events", "none").css("opacity", "0.5");
      });
    } else if (key === "system_version") {
      document.title = data[key];
    } else {
      element = $("#" + key);
      if (!element || !element[0]) {
        continue;
      }
      if (element[0].nodeName === "BUTTON") {
        element.removeClass(
          "active-green active-red active-yellow active-white flash-green flash-red flash-yellow flash-white"
        );
        if (!data[key].toString().startsWith("none")) {
          element.addClass(data[key]);
        }
        if (key.startsWith("set_")) {
          let index = key.split("_")[1];
          let id = index === "1" ? "A" : "B";
          let layer = canvasPip.getObjects().find((obj) => obj.id === id);
          canvasPip.setActiveObject(layer);
          canvasPip.bringToFront(layer);
        } else if (key === "mode") {
          if (data[key].toString() === "active-green") {
            canvasPip.remove(pgm);
            canvasPip.add(pst);
            canvasPip.bringToFront(pst);
            mode = 0;
          } else if (data[key].toString() === "active-red") {
            canvasPip.remove(pst);
            canvasPip.add(pgm);
            canvasPip.bringToFront(pgm);
            mode = 1;
          }
          checkPip();
        } else if (key.startsWith("pip")) {
          pip[key] =
            data[key].toString().startsWith("active") ||
              data[key].toString().startsWith("flash")
              ? 1
              : 0;
          checkPip();
        } else if (key.startsWith("logo")) {
          logo[key] =
            data[key].toString().startsWith("active") ||
              data[key].toString().startsWith("flash")
              ? 1
              : 0;
          checkLogo();
        }
        // element.val(data[key]);
      } else if (element[0].nodeName === "INPUT") {
        if (key === "stream-1-server") {
          defaultStreamAddress[1] = data[key];
        } else if (key === "stream-2-server") {
          defaultStreamAddress[2] = data[key];
        }

        if (element[0].name === "audio_mode") {
          if (element[0].type === "checkbox") {
            element.prop("checked", data[key] === 1);
          } else {
            element.val(modeArr[data[key]]);
          }
        } else if (element[0].name === "audio_mic_mode") {
          element.val(micModeArr[data[key]]);
        } else if (element[0].name === "audio_source") {
          element.val(sourceArr[data[key]]);
        } else if (
          element[0].type === "range" &&
          Number(element.val()) !== data[key]
        ) {
          let value = data[key];
          // if float value, set to 2 decimal places
          if (value % 1 !== 0) {
            value = value.toFixed(2);
          }
          element.val(value);
          element.attr("value", value);
          element.change();
          // emit property change event
          // let event = new Event('propertychange');
          // element[0].dispatchEvent(event);
          // $("input[name=" + element[0].name + "][type='number']").val(value);
        } else if (element[0].type === "color") {
          element.val(data[key]);
          element.change();
        } else {
          element.val(data[key]);
        }
      } else if (element[0].nodeName === "SELECT") {
        element.val(data[key]);
      }
    }
  }

  remoteSync = false;
}

function checkPip() {
  let layerA = canvasPip.getObjects().find((obj) => obj.id === "A");
  let layerB = canvasPip.getObjects().find((obj) => obj.id === "B");

  layerA.visible =
    (mode === 0 && pip["pip1"] === 1) ||
    (mode === 1 && pip["pip1-on-air"] === 1);
  layerB.visible =
    (mode === 0 && pip["pip2"] === 1) ||
    (mode === 1 && pip["pip2-on-air"] === 1);

  layerA.set({
    borderColor: layerA.visible ? "green" : "transparent",
    cornerColor: layerA.visible ? "white" : "transparent",
  });
  layerB.set({
    borderColor: layerB.visible ? "green" : "transparent",
    cornerColor: layerB.visible ? "white" : "transparent",
  });
  canvasPip.renderAll();
}

function checkLogo() {
  let logo1 = canvasLogo.getObjects().find((obj) => obj.id === "logo_1");
  let logo2 = canvasLogo.getObjects().find((obj) => obj.id === "logo_2");
  logo1.visible = logo["logo1"] === 1;
  logo2.visible = logo["logo2"] === 1;
  canvasLogo.renderAll();
}

function stopWebSocket() {
  if (websocket) websocket.close();
}
