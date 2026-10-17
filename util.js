var language = 0; //0:en 1:cn 2:kr
var languageList = ["en", "zh"];
var languageImageList = ["./image/EN.png", "./image/CN.png"];
String.prototype.isChinese = function () {
  var re = /[\u4e00-\u9fff]/;
  if (re.test(this)) return true;
  return false;
};
String.prototype.isEnglish = function () {
  var re = /[A-Za-z]+/;
  if (re.test(this)) return true;
  return false;
};

String.prototype.isKorean = function () {
  var cnt = 0;
  var temp = this;
  var re = /[\uac00-\ud7ff]/;
  for (var i = 0; i < temp.length; i++) {
    var char = temp.charAt(i);
    if (re.test(char)) {
      cnt++;
    }
  }
  if (cnt > 0) return true;
  return false;
};
var languageMap = {};
var languageMapTemplate = {
  0: ["Notice", "提示", "힌트"],
  1: [
    "Please enter the streaming address",
    "请输入推流地址",
    "스트리밍 주소를 입력하세요",
  ],
  2: [
    "Please enter the stream key",
    "请输入串流密钥",
    "스트리밍 키(Key)를 입력하세요",
  ],
  3: ["Start stream succeeded", "推流成功", "스트리밍 시작 성공"],
  4: ["Streaming 1 is closed", "推流1已关闭", "스트림 1 닫힘"],
  5: ["Streaming 2 is closed", "推流2已关闭", "스트림 2 닫힘"],
  6: ["Save<br/>successed", "保存成功", "저장 성공"],
  7: ["Upload<br/>successed", "上传成功", "업로드 성공"],
  8: ["Update<br/>successed", "升级成功", "업데이트 성공"],
  9: ["Update<br/>failed", "升级失败", "업데이트 실패"],
  10: ["Please select a picture", "请选择图片", "그림을 선택하세요"],
  11: ["The picture has been uploaded", "该图片已上传", ""],
  12: [
    "The network IP will be redistributed, the host computer will be disconnected and needs to be reconnected",
    "网络IP将重新分配,上位机将会断开连接,需要重新连接",
    "네트워크 IP가 재배당될 것이며, 호스트 컴퓨터의 연결을 제거했다가 다시 연결해 주세요",
  ],
  13: [
    "System reset will delete all configurations",
    "系统复位将删除所有配置，确认复位？",
    "시스템 초기화는 모든 설정을 삭제합니다?",
  ],
  14: ["Upload<br/>failed", "上传失败", "업로드 실패"],
  15: ["STREAM", "推流", "스트리밍"],
  16: ["Cancel", "取消", "취소"],
  17: ["Confirm", "确定", "확인하다"],
  18: ["Show", "显示", "보이기"],
  19: ["Hide", "隐藏", "숨기기"],
  20: ["Update Firmware", "升级 固件", "업데이트 펌웨어"],
  21: ["Update EDID", "升级 EDID", "업데이트 EDID"],
  22: ["Update", "升级", "업데이트"],
  23: [
    "Are you sure to delete this image?",
    "确认删除该图片？",
    "이미지 삭제 확인하시겠습니까?",
  ],
  24: ["File uploaded successfully", "文件上传成功", "파일 업로드 성공"],
  25: ["Failed to upload file", "文件上传失败", "파일 업로드 실패"],
  26: [
    "Login failed, please check your account and password.",
    "登录失败，请检查用户名和密码",
    "",
  ],
  27: ["Please fill in all the information", "请填写所有信息", ""],
  28: ["The password is inconsistent twice", "两次密码不一致", ""],
  29: ["The modification was successful", "修改成功", ""],
};

function regroupLanguageMap(list) {
  var arr = list;
  var length = 23;
  for (let index = 0; index < length; index++) {
    languageMap[index] = [];
  }
  for (let index = 0; index < arr.length; index++) {
    const element = arr[index];
    if (element.isChinese()) {
      languageList.push("zh");
      languageImageList.push("./image/CN.png");
      for (let y = 0; y < length; y++) {
        languageMap[y].push(languageMapTemplate[y][1]);
      }
    } else if (element.isKorean()) {
      languageList.push("kr");
      languageImageList.push("./image/KR.png");
      for (let y = 0; y < length; y++) {
        languageMap[y].push(languageMapTemplate[y][2]);
      }
    } else {
      languageList.push("en");
      languageImageList.push("./image/EN.png");
      for (let y = 0; y < length; y++) {
        languageMap[y].push(languageMapTemplate[y][0]);
      }
    }
  }
}

//自定义土司
function toast({ title = "", message = "", type = "info", duration = 2000 }) {
  const main = $("#toast");
  if (main) {
    // console.log(main);
    // const toast = document.createElement("div");
    const toast = $("<div>");
    // console.log(toast);
    // Auto remove toast
    const autoRemoveId = setTimeout(function () {
      main.children().remove();
    }, duration);

    // Remove toast when clicked
    toast[0].onclick = function (e) {
      if (e.target.closest(".toast__close")) {
        main.children().remove();
        clearTimeout(autoRemoveId);
      }
    };

    const icons = {
      success: "fa fa-check-circle",
      info: "fa fa-info-circle",
      warning: "fa fa-exclamation-circle",
      error: "fa fa-exclamation-circle",
    };
    const icon = icons[type];
    const delay = (duration / 1000).toFixed(2);

    toast.addClass("toast");
    toast.addClass(`toast--${type}`);
    toast.css(
      "animation",
      `slideInLeft ease .3s, fadeOut linear 1s ${delay}s forwards`
    );
    // <h3 class="toast__title">${title}</h3>

    toast.html(`
                <div class="toast__icon">
                    <i class="${icon}"></i>
                    <i class="fa fa-times-circle toast__close"></i>
                </div>
                <div class="toast__body">
                    <p class="toast__msg">${message}</p>
                </div>
            `);
    main[0].append(toast[0]);
  }
}

//自定义弹窗
function dialog({ title = "", message = "" }, success, cancel) {
  const main = $(".info_dialog");
  const mask = $(".dialog_box");
  // '<h2 class="dialog_title" style="margin-top:10px">' +
  // title +
  if (main) {
    var c = "Cancel";
    var s = "Confirm";

    main.html(
      '<span class="dialog_info"><i class="fa fa-exclamation-circle" aria-hidden="true"></i></span>' +
        "</h2>" +
        '<p class="dialog_content" style="margin-top:50px; text-align:center">' +
        message +
        "</p>" +
        '<div style="display:flex;justify-content: center;"><div class="dialog_cancel" style="margin-top:0px;margin-bottom: 20px;">' +
        c +
        "</div>" +
        '<div class="dialog_confirm" style="margin-top:0px;margin-bottom: 20px;">' +
        s +
        "</div></div>"
    );
    var dialogClose = $(".dialog_cancel");
    var dialogConfirm = $(".dialog_confirm");

    dialogClose.on("click", function () {
      cancel();
      main.removeClass("dialog_active");
      mask.removeClass("dialog_box_active");
    });
    dialogConfirm.on("click", function () {
      success();
      main.removeClass("dialog_active");
      mask.removeClass("dialog_box_active");
    });
    // console.log(main);
    main.toggleClass("dialog_active");
    mask.toggleClass("dialog_box_active");
  }
}

function fileDialog({ type = "", name = "" }, success, cancel) {
  const main = $(".info_dialog");
  const mask = $(".dialog_box");
  if (main) {
    var title =
      type == "systemUpload"
        ? languageMap[20][language]
        : languageMap[21][language];
    main.html(
      '<span class="dialog_info"><i class="fa fa-exclamation-circle" aria-hidden="true"></i></span>' +
        '<span class="dialog_close"><i class="fa fa-times-circle" aria-hidden="true"></i></span>' +
        '<h2 class="dialog_title">' +
        title +
        "</h2>" +
        '<p class="file-item">' +
        name +
        "</p>" +
        '<button class="button-stream" style="margin-left:calc(50% - 40px);background: var(--item-hover-bg);border:none;color:white">' +
        "<span></span><span></span><span></span><span></span>" +
        languageMap[22][language] +
        "</button>"
    );
    var dialogClose = $(".dialog_close");
    var dialogConfirm = $(".info_dialog .button-stream");
    // var dialogFile = $(".file-item");
    // dialogFile.on("click", function () {
    //   fileDelete(type);
    // });
    dialogClose.on("click", function () {
      cancel();
      main.removeClass("dialog_active");
      mask.removeClass("dialog_box_active");
    });
    dialogConfirm.on("click", function () {
      dialogConfirm.addClass("active");
      success();
    });
    // console.log(main);
    main.toggleClass("dialog_active");
    mask.toggleClass("dialog_box_active");
  }
}

String.prototype.colorHex = function () {
  // RGB颜色值的正则
  var reg = /^(rgb|RGB)/;
  var color = this;
  if (reg.test(color)) {
    var strHex = "#";
    // 把RGB的3个数值变成数组
    var colorArr = color.replace(/(?:\(|\)|rgb|RGB)*/g, "").split(",");
    // 转成16进制
    for (var i = 0; i < colorArr.length; i++) {
      var hex = Number(colorArr[i]).toString(16);
      if (Number(colorArr[i]) < 16) {
        hex = "0" + hex;
      }
      strHex += hex;
    }
    return strHex;
  } else {
    return String(color);
  }
};
String.prototype.colorRgb = function () {
  // 16进制颜色值的正则
  var reg = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;
  // 把颜色值变成小写
  var color = this.toLowerCase();
  if (reg.test(color)) {
    // 如果只有三位的值，需变成六位，如：#fff => #ffffff
    if (color.length === 4) {
      var colorNew = "#";
      for (var i = 1; i < 4; i += 1) {
        colorNew += color.slice(i, i + 1).concat(color.slice(i, i + 1));
      }
      color = colorNew;
    }
    // 如果只有五位的值，需变成六位，如：#10f0f => #010f0f
    if (color.length === 6) {
      console.log(colorNew);
      color = "#0" + color.substring(1);
    }
    // 处理六位的颜色值，转为RGB
    var colorChange = [];
    for (var i = 1; i < 7; i += 2) {
      colorChange.push(parseInt("0x" + color.slice(i, i + 2)));
    }
    return colorChange;
  } else {
    return color;
  }
};

String.prototype.isValidIP = function () {
  var reg =
    /^(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])$/;
  return reg.test(this);
};

var optionsMap = {
  fps: ["24", "25", "30", "50", "60"],
  rate: ["x0.2", "x0.4", "x0.6", "x0.8", "x1.0", "x1.2"],
  switch: ["AUTO", "OFF", "ON"],
  "time-format": ["12h", "24h"],
  language: ["English", "中文"],
  "dip-mode": ["COLOR", "IN1", "IN2", "IN3", "IN4", "MEDIA", "PAT"],
};
String.prototype.getOptions = function () {
  var list = optionsMap[this];
  var optionstring = "";
  optionsMap[this].forEach(function (item, index) {
    optionstring +=
      '<option style="background:var(--item-bg);" value="' +
      index +
      '" >' +
      item +
      "</option>";
  });
  return optionstring;
};

function getTime(type) {
  var time = new Date();
  time = time.toLocaleTimeString("en-GB", { hour12: type === 1 });
  return time.substring(0, time.lastIndexOf(":"));
}

function getDate() {
  var date = new Date();
  var year = date.getFullYear(); //年
  var month = ("0" + (date.getMonth() + 1)).slice(-2); //月
  var day = ("0" + date.getDate()).slice(-2); //日
  var mydate = year + "-" + month + "-" + day;
  return mydate;
}

function getTimeArray() {
  var date = new Date();
  var year = date.getFullYear(); //获取年份
  var month = date.getMonth() + 1; //获取月份
  var day = date.getDate(); //获取日期
  var hour = date.getHours(); //获取小时
  var minute = date.getMinutes(); // 获取分
  var seconds = date.getSeconds(); //获取秒
  return (
    year + "," + month + "," + day + "," + hour + "," + minute + "," + seconds
  );
}

function getDateTimeString() {
  let time = new Date();
  return (
    time.getFullYear() +
    "-" +
    (time.getMonth() + 1) +
    "-" +
    time.getDate() +
    " " +
    time.getHours() +
    ":" +
    time.getMinutes() +
    ":" +
    time.getSeconds()
  );
}

function addCanvasRect({ left, top, width, height, textValue }) {
  // console.log(left, top, width, height);
  let leftScale = (left * canvasPipW) / 1920.0;
  let topScale = (top * canvasPipH) / 1080.0;
  let widthScale = (width * canvasPipW) / 1920.0;
  let heightScale = (height * canvasPipH) / 1080.0;
  let textSize = 60 * (widthScale / canvasPipW);
  if (textSize < 16) textSize = 16;
  console.log(leftScale, topScale, widthScale, heightScale);
  let text = new fabric.Textbox(textValue, {
    fontSize: textSize,
    fill: "black",
    top: 10,
    left: 10,
    // fontWeight: "bold",
    fontFamily: "Arial",
    id: textValue + "_label",
    // originX: "center",
    // originY: "center",
  });
  let pos = new fabric.Textbox(
    "POS(" + (left - width / 2) + "," + (top - height / 2) + ")",
    {
      top: heightScale - 45,
      left: 10,
      // top: 0,
      // left: 0,
      height: 20,
      fontSize: textSize / 2,
      fill: "black",
      // fontWeight: "bold",
      fontFamily: "Arial",
      id: textValue + "_pos",
    }
  );
  let size = new fabric.Textbox("SIZE(" + width + "," + height + ")", {
    top: heightScale - 25,
    left: 10,
    // top: 0,
    // left: 0,
    height: 20,
    fontSize: textSize / 2,
    fill: "black",
    // fontWeight: "bold",
    fontFamily: "Arial",
    id: textValue + "_size",
  });
  // 矩形对象
  let rect = new fabric.Rect({
    fill: textValue === "A" ? "rgb(198,198,198)" : "rgb(133,160,221)", // 填充色：透明
    stroke: "rgb(255, 255, 255)", // 边框颜色：黑色
    strokeWidth: 1,
    width: widthScale,
    height: heightScale,
    strokeUniform: true, //边框宽度不随缩放改变
    id: textValue + "_rect",
    // originX: "center",
    // originY: "center",
  });
  let group = new fabric.Group([rect, text, pos, size], {
    top: topScale,
    left: leftScale,
    borderColor: "rgb(57, 243, 57)",
    lockScalingFlip: true, // true时，对象不能通过缩放为负值来翻转
    id: textValue,
    originX: "center", //group的坐标原点为矩形的中心点
    originY: "center",
  });

  // layerTextPosA.set({top: height/2-45, left: -width/2 + 10});
  // layerTextSizeA.set({top: height/2-25, left: -width/2 + 10});

  // group.set("selectable", false);
  // 将矩形添加到画布上
  canvasPip.add(group);
  // if (selectedLayer == textValue) {
  //   canvasPip.setActiveObject(group);
  //   canvasPip.bringToFront(group);
  // }
}

function addCanvasChromaRect({ top, left, width, height }) {
  // 矩形对象
  var rect = new fabric.Rect({
    fill: "transparent", // 填充色：透明
    stroke: "rgb(255, 255, 255)", // 边框颜色：黑色
    strokeWidth: 1,
    width,
    height,
    top,
    left,
    borderColor: "rgb(57, 243, 57)",
    lockScalingFlip: true, // true 时，对象不能通过缩放为负值来翻转
    strokeUniform: true,
    id: "chroma",
  });
  // 将矩形添加到画布上
  canvasChroma.add(rect);
}

function loadProperties(lang) {
  $.i18n.properties({
    name: "i18n", //资源文件名称，命名格式：文件名_国家代号.properties
    path: "lang/", //资源文件路径，注意这里路径是你属性文件的所在文件夹,可以自定义。
    mode: "map", //用 Map 的方式使用资源文件中的值
    language: lang, //这就是国家代号 name+language刚好组成属性文件名：i18n+zh -> i18n_zh.properties
    callback: function () {
      $("[data-locale]").each(function () {
        $(this).html($.i18n.prop($(this).data("locale")));
      });
      $("[data-placeholder]").each(function () {
        $(this).prop("placeholder", $.i18n.prop($(this).data("placeholder")));
      });
    },
  });
}

//将base64转换为blob
function dataURLtoFile(dataurl, fileName) {
  var arr = dataurl.split(","),
    mime = arr[0].match(/:(.*?);/)[1],
    bstr = atob(arr[1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], fileName, { type: mime });

  // return new Blob([u8arr], { type: mime });
}

//将blob转换为file
function blobToFile(theBlob, fileName) {
  theBlob.lastModifiedDate = new Date();
  theBlob.name = fileName;
  return new File([theBlob], fileName);
}
