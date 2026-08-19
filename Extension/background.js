// background.js - [민재 VLM 권한 파이프라인] + [토글 최소화 롤백] 최종본

const BACKEND_WS = "ws://127.0.0.1:8000/ws/audio";
const WIDGET_URL = "http://127.0.0.1:9998"; // flutter run -d chrome 주소

// 크기 조절 시 위젯이 터지는 걸 방지하는 최소/최대 규격 제한 한계선 세팅
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

let activeTabId = null;

chrome.action.onClicked.addListener(async (tab) => {
  if (activeTabId === tab.id) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: removeWidget });
    await chrome.runtime.sendMessage({ type: "stop-capture" });
    activeTabId = null;
    return;
  }

  activeTabId = tab.id;
  const lectureId = "lecture-" + tab.id;

  // [중요] 스크립트 인젝션 시 반응형 최소/최대 크기 상수를 args 배열 인자로 안전하게 패스
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: injectWidget,
    args: [WIDGET_URL, lectureId, MIN_WIDTH, MAX_WIDTH]
  });

  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "탭 오디오 캡처 후 STT 서버로 전송"
    });
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  chrome.runtime.sendMessage({ type: "start-capture", streamId, lectureId, wsBase: BACKEND_WS });
});

function injectWidget(url, lectureId, minWidth, maxWidth) {
  if (document.getElementById("llai-widget")) return;

  const iframe = document.createElement("iframe");
  iframe.id = "llai-widget";
  
  // main.dart 라우터가 주소를 동적으로 파싱할 수 있게 파라미터는 무조건 'room' 유지
  iframe.src = url + "/?room=" + lectureId;
  
  // 외부 LMS 사이트 내부에서도 화면 캡처 및 음성 권한을 프리패스 시키는 핵심 마스터 키 유지
  iframe.setAttribute("allow", "display-capture; microphone; camera;");
  
  Object.assign(iframe.style, {
    position: "fixed", 
    top: "20px", 
    right: "20px",
    width: "380px", 
    height: "560px", 
    border: "none",
    zIndex: "2147483647", 
    opacity: "0.95", // 고유 UI 불투명도 스타일 보존
    background: "transparent", 
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)", 
    borderRadius: "12px"
  });

  document.body.appendChild(iframe);

  // 플러터 위젯에서 최소화/복원 신호 전송 시 브라우저가 반응하는 리스너 엔진
  window.addEventListener("message", (event) => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data || {};

    // 설정 창 슬라이더 조절 및 최소화 스위칭 시 실시간 규격 리사이징 파트
    if (data.type === "llai-resize") {
      // 1. 가로 너비 리사이즈 (최소화 70px 스펙 예외 허용 처리)
      if (typeof data.width === "number") {
        const minConstraint = data.width === 70 ? 70 : minWidth;
        const clampedWidth = Math.min(maxWidth, Math.max(minConstraint, data.width));
        iframe.style.width = clampedWidth + "px";
      }
      
      // 2. 세로 높이 리사이즈 (전달받은 명시적 높이로 동적 리사이징 단행)
      if (typeof data.height === "number") {
        iframe.style.height = data.height + "px";
      }
    }
  });
}

function removeWidget() {
  document.getElementById("llai-widget")?.remove();
}
