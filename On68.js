// ==UserScript==
// @name         ON68 Auto Full: Đăng Ký -> Captcha -> Rút -> Bank -> Xác Nhận -> Reload + Telegram Bot v8.3
// @namespace    http://tampermonkey.net/
// @version      8.3
// @description  Tự động hoàn tất quy trình, giải captcha OMO, liên kết ngân hàng, xác nhận rút tiền và tự động gửi thông tin tài khoản về Telegram với thông số mới.
// @match        *://*.onn68g.com/*
// @match        *://onn68g.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      omocaptcha.com
// @connect      static.botion.com
// @connect      api.telegram.org
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const BANK_LIST = [
        "ACB BANK", "AGRIBANK", "BIDV BANK", "LIO BANK", "LP BANK", "MB BANK", 
        "MSB", "NAM A BANK", "NCB BANK", "OCB BANK", "PVCOM BANK", "SEA BANK", 
        "SHB BANK", "TPBANK", "VIETCOM BANK", "VIETINBANK", "State Bank of Vietnam", 
        "Vikki by HD BANK", "AB BANK", "ALL BANK SUPPORT", "ANZ BANK", "BAC A BANK", 
        "BAOVIET BANK", "CB BANK", "FIRST BANK", "HD BANK", "Hong Leong Bank", 
        "INDOVINA BANK", "KB KOOKMIN BANK", "KEB Hana Bank", "KIENLONG BANK", 
        "MBV BANK", "NONGHYUP BANK", "PG BANK", "Public Bank", "SACOM BANK", 
        "SAIGON BANK", "SCB BANK", "SHINHAN BANK", "Social Policy Bank of Vietnam", 
        "TECHCOM BANK", "TIMO BY BAN VIET BANK", "UOB (United Overseas Bank)", 
        "VIB BANK", "VIET A BANK", "VIET BANK", "Vietnam Development Bank", 
        "Vikki Digital Bank", "VPBANK", "VR BANK", "WOORI BANK"
    ];

    const BRANCH_LIST = [
        "Chi nhánh Hồ Chí Minh", "Chi nhánh Hà Nội", "Chi nhánh Đà Nẵng", 
        "Chi nhánh Cần Thơ", "Chi nhánh Hải Phòng", "Chi nhánh Biên Hòa", 
        "Chi nhánh Bình Dương", "Chi nhánh Vũng Tàu", "Chi nhánh Nha Trang"
    ];

    const CONFIG = {
        apiKey: "OMO_83ZSGES7YPDVMYBP4SMYCZOYBYXVXXHCEX95BIB5LBB1ITZELX4GEQ94UGYSZ91783164555",
        targetUrl: 'https://www.onn68g.com/m/home?referralCode=str2250',
        promoUrl: 'https://www.on68khuyenmai.com/?promo_id=FR68',
        // Cấu hình Telegram mới
        tgBotToken: '8839097708:AAEyDT6DwIKqy6bJAnLx_JuAmHcsB_DTAlw',
        tgChatId: '8962161965',
        get selectedBank() { return GM_getValue('selected_bank', 'VIETCOM BANK'); },
        set selectedBank(val) { GM_setValue('selected_bank', val); },
        get bankAccountNum() { return GM_getValue('bank_account_num', '19036888888888'); },
        set bankAccountNum(val) { GM_setValue('bank_account_num', val); }
    };

    let isSubmitting = false;
    let submitTimer = null;
    let unlockTimer = null;

    let lastProcessedBg = '';
    let isProcessingCaptcha = false;
    let captchaRetryCount = 0;
    const MAX_CAPTCHA_RETRIES = 3;
    let captchaScannerInterval = null;
    let isWaitingForPostAction = false;

    let currentRegInfo = {
        username: '',
        password: 'Tanthu123',
        withdrawPass: '123456',
        fullName: '',
        bankName: '',
        stk: ''
    };

    function sendTelegramNotification(title, extraMsg = '') {
        const text = `🤖 *[ON68 Auto Bot]* - ${title}\n\n` +
                     `👤 *Tài khoản:* \`${currentRegInfo.username || 'N/A'}\`\n` +
                     `🔑 *MK Đăng nhập:* \`${currentRegInfo.password}\`\n` +
                     `💰 *MK Rút tiền:* \`${currentRegInfo.withdrawPass}\`\n` +
                     `📛 *Họ tên:* ${currentRegInfo.fullName || 'N/A'}\n` +
                     `🏦 *Ngân hàng:* ${currentRegInfo.bankName || CONFIG.selectedBank}\n` +
                     `💳 *Số STK:* \`${currentRegInfo.stk || CONFIG.bankAccountNum}\`\n` +
                     (extraMsg ? `\n📌 *Trạng thái:* ${extraMsg}\n` : '') +
                     `🕒 *Thời gian:* ${new Date().toLocaleString('vi-VN')}`;

        GM_xmlhttpRequest({
            method: "POST",
            url: `https://api.telegram.org/bot${CONFIG.tgBotToken}/sendMessage`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                chat_id: CONFIG.tgChatId,
                text: text,
                parse_mode: "Markdown"
            }),
            onload: function(response) {
                try {
                    const res = JSON.parse(response.responseText);
                    if (res.ok) {
                        appendLog("Telegram", "Đã gửi thông tin tài khoản về Telegram thành công!");
                    } else {
                        appendLog("Lỗi Telegram", res.description || 'Không gửi được tin nhắn');
                    }
                } catch (e) {
                    appendLog("Lỗi Telegram", "Parse JSON thất bại");
                }
            },
            onerror: () => appendLog("Lỗi Telegram", "Mất kết nối mạng khi gọi API Telegram")
        });
    }

    function initUI() {
        if (document.getElementById('master-bot-ui')) return;
        if (!document.body) {
            setTimeout(initUI, 300);
            return;
        }

        const uiContainer = document.createElement('div');
        uiContainer.id = 'master-bot-ui';
        uiContainer.style.cssText = `
            position: fixed !important;
            top: 100px !important;
            right: 15px !important;
            z-index: 2147483647 !important;
            background: rgba(18, 18, 24, 0.96) !important;
            border: 1px solid #ff5722 !important;
            border-radius: 8px !important;
            box-shadow: 0 6px 20px rgba(0,0,0,0.6) !important;
            width: 310px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace !important;
            font-size: 12px !important;
            color: #eee !important;
            box-sizing: border-box !important;
            backdrop-filter: blur(6px) !important;
        `;

        const bankOptionsHtml = BANK_LIST.map(bank => 
            `<option value="${bank}" ${CONFIG.selectedBank === bank ? 'selected' : ''}>${bank}</option>`
        ).join('');

        uiContainer.innerHTML = `
            <div id="ui-header" style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; background: #24252d; border-radius: 7px 7px 0 0; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: move;">
                <span style="font-weight: bold; color: #ff5722;">🤖 ON68 Auto v8.3</span>
                <div style="display: flex; gap: 5px; align-items: center;">
                    <span id="ui-status-badge" style="font-size: 10px; background: #444; padding: 2px 6px; border-radius: 3px; color: #aaa;">Sẵn sàng</span>
                    <button id="ui-btn-minimize" title="Thu gọn" style="background: none; border: 1px solid #555; color: #fff; border-radius: 3px; cursor: pointer; font-size: 10px; padding: 1px 6px;">_</button>
                </div>
            </div>

            <div id="ui-body" style="padding: 10px;">
                <button id="btn-redirect" style="width: 100%; background: #ff9800; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px;">
                    🔗 Mở link giới thiệu ON68
                </button>
                
                <button id="btn-promo" style="width: 100%; background: #ec4899; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 8px;">
                    🎁 Mở trang Khuyến Mãi (KM)
                </button>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; margin-bottom: 2px; color: #bbb;">Họ và Tên:</label>
                    <input type="text" id="ui-fullname" placeholder="VD: NGUYEN VAN A" style="width: 100%; padding: 5px 8px; box-sizing: border-box; background: #2a2b36; border: 1px solid #444; border-radius: 4px; font-size: 12px; color: #fff;">
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; margin-bottom: 2px; color: #bbb;">Số Tài Khoản Ngân Hàng:</label>
                    <input type="text" id="ui-stk" placeholder="Nhập số tài khoản..." style="width: 100%; padding: 5px 8px; box-sizing: border-box; background: #2a2b36; border: 1px solid #444; border-radius: 4px; font-size: 12px; color: #fff;">
                </div>

                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 2px; color: #bbb;">Chọn Ngân Hàng:</label>
                    <select id="ui-bank-select" style="width: 100%; padding: 5px; background: #2a2b36; border: 1px solid #444; border-radius: 4px; color: #fff; font-size: 12px;">
                        ${bankOptionsHtml}
                    </select>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <button id="btn-start" style="background: #10b981; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">▶ Bắt đầu</button>
                    <button id="btn-stop" style="background: #ef4444; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">⏹ Dừng</button>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 11px;">
                    <span style="color: #94a3b8;">Log hành động:</span>
                    <a id="ui-clear-log" style="color: #60a5fa; cursor: pointer; text-decoration: underline;">Xóa Log</a>
                </div>

                <div id="ui-log-box" style="background: #0d0e12; border: 1px solid #2e303d; border-radius: 4px; height: 100px; overflow-y: auto; padding: 6px; font-family: monospace; font-size: 11px; line-height: 1.35; display: flex; flex-direction: column; gap: 3px;">
                    <div style="color: #64748b;">[System] Sẵn sàng hoạt động (v8.3)...</div>
                </div>
            </div>
        `;

        document.body.appendChild(uiContainer);
        makeDraggable(uiContainer, document.getElementById('ui-header'));

        const nameInputEl = document.getElementById('ui-fullname');
        nameInputEl.value = localStorage.getItem('auto_user_fullname') || 'NGUYEN VAN A';
        nameInputEl.addEventListener('input', () => {
            localStorage.setItem('auto_user_fullname', nameInputEl.value);
        });

        const stkInputEl = document.getElementById('ui-stk');
        stkInputEl.value = CONFIG.bankAccountNum;
        stkInputEl.addEventListener('input', () => {
            CONFIG.bankAccountNum = stkInputEl.value;
        });

        document.getElementById('ui-bank-select').addEventListener('change', (e) => {
            CONFIG.selectedBank = e.target.value;
            appendLog("Cấu hình", `Đã đổi ngân hàng thành: ${CONFIG.selectedBank}`);
        });

        let isMinimized = false;
        const btnMinimize = document.getElementById('ui-btn-minimize');
        const uiBody = document.getElementById('ui-body');
        btnMinimize.onclick = () => {
            isMinimized = !isMinimized;
            uiBody.style.display = isMinimized ? 'none' : 'block';
            btnMinimize.innerText = isMinimized ? '□' : '_';
        };

        document.getElementById('ui-clear-log').onclick = () => {
            document.getElementById('ui-log-box').innerHTML = '<div style="color: #64748b;">[System] Đã xóa log.</div>';
        };

        document.getElementById('btn-redirect').onclick = () => { window.location.href = CONFIG.targetUrl; };
        document.getElementById('btn-promo').onclick = () => { window.location.href = CONFIG.promoUrl; };
        document.getElementById('btn-start').onclick = runAutoFillAndSubmit;
        document.getElementById('btn-stop').onclick = stopAllActions;

        if (!captchaScannerInterval) {
            captchaScannerInterval = setInterval(processCaptcha, 800);
        }
    }

    function makeDraggable(elmnt, dragHandle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        dragHandle.onmousedown = dragMouseDown;
        dragHandle.ontouchstart = dragTouchStart;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
            elmnt.style.right = "auto";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }

        function dragTouchStart(e) {
            if (e.touches.length === 1) {
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
                document.ontouchend = closeTouchDragElement;
                document.ontouchmove = elementTouchDrag;
            }
        }

        function elementTouchDrag(e) {
            if (e.touches.length === 1) {
                pos1 = pos3 - e.touches[0].clientX;
                pos2 = pos4 - e.touches[0].clientY;
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
                elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
                elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
                elmnt.style.right = "auto";
            }
        }

        function closeTouchDragElement() {
            document.ontouchend = null;
            document.ontouchmove = null;
        }
    }

    function appendLog(title, data) {
        const box = document.getElementById('ui-log-box');
        if (!box) return;

        const row = document.createElement('div');
        row.style.borderBottom = '1px dashed rgba(255,255,255,0.06)';
        row.style.paddingBottom = '2px';

        const time = new Date().toTimeString().split(' ')[0];
        let content = '';
        if (typeof data === 'object') {
            content = `<pre style="margin:2px 0 0 0; color: #38bdf8; font-size: 10px; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>`;
        } else {
            content = `<span style="color:#e2e8f0;">${data}</span>`;
        }

        row.innerHTML = `<span style="color: #64748b;">[${time}]</span> <b style="color: #f59e0b;">${title}:</b> ${content}`;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
    }

    function updateBadge(text, bgColor = '#444') {
        const tag = document.getElementById('ui-status-badge');
        if (tag) {
            tag.innerText = text;
            tag.style.background = bgColor;
            tag.style.color = '#fff';
        }
    }

    function setInputValue(el, value) {
        if (!el) return;
        const prototype = Object.getPrototypeOf(el);
        const prototypeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        const ownSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;

        if (prototypeSetter && ownSetter !== prototypeSetter) {
            prototypeSetter.call(el, value);
        } else if (ownSetter) {
            ownSetter.call(el, value);
        } else {
            el.value = value;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getRandomAccount() {
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        const chars = letters + '0123456789';
        let res = letters[Math.floor(Math.random() * letters.length)];
        for (let i = 0; i < 7; i++) {
            res += chars[Math.floor(Math.random() * chars.length)];
        }
        return res;
    }

    function getRandomPhone() {
        const prefixes = ['032', '033', '034', '035', '038', '039', '070', '079', '083', '085', '090', '098'];
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        let suffix = '';
        for (let i = 0; i < 7; i++) suffix += Math.floor(Math.random() * 10);
        return prefix + suffix;
    }

    function removeVietnameseTones(str) {
        return str.normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
                  .toUpperCase()
                  .trim();
    }

    function findInputByKeyword(kw) {
        const inputs = document.querySelectorAll('input:not([id^="ui-"])');
        for (const input of inputs) {
            const ph = (input.getAttribute('placeholder') || '').toLowerCase();
            if (ph.includes(kw.toLowerCase())) return input;
        }
        return null;
    }

    function runAutoFillAndSubmit() {
        if (isSubmitting) return;
        isSubmitting = true;

        updateBadge('Đang điền...', '#3b82f6');
        appendLog("Form", "Đang khởi tạo thông tin đăng ký...");

        const nameInputEl = document.getElementById('ui-fullname');
        const fullName = removeVietnameseTones(nameInputEl ? nameInputEl.value : 'NGUYEN VAN A');
        const randomAcc = getRandomAccount();
        const randomPhone = getRandomPhone();
        const fixedPass = 'Tanthu123';

        currentRegInfo.username = randomAcc;
        currentRegInfo.password = fixedPass;
        currentRegInfo.fullName = fullName;
        currentRegInfo.stk = document.getElementById('ui-stk')?.value || CONFIG.bankAccountNum;
        currentRegInfo.bankName = CONFIG.selectedBank;

        let accInput = findInputByKeyword('tài khoản');
        let passInput = findInputByKeyword('mật khẩu');
        let nameInput = findInputByKeyword('họ và tên') || findInputByKeyword('ngân hàng');
        let phoneInput = findInputByKeyword('sđt') || findInputByKeyword('sdt');

        if (!accInput || !passInput || !nameInput || !phoneInput) {
            const visibleInputs = Array.from(document.querySelectorAll('input:not([id^="ui-"])'))
                .filter(el => el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio');
            if (visibleInputs.length >= 4) {
                accInput = accInput || visibleInputs[0];
                passInput = passInput || visibleInputs[1];
                nameInput = nameInput || visibleInputs[2];
                phoneInput = phoneInput || visibleInputs[3];
            }
        }

        if (accInput) setInputValue(accInput, randomAcc);
        if (passInput) setInputValue(passInput, fixedPass);
        if (nameInput) setInputValue(nameInput, fullName);
        if (phoneInput) setInputValue(phoneInput, randomPhone);

        const checkbox = document.querySelector('input[type="checkbox"]:not([id^="ui-"])');
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        submitTimer = setTimeout(() => {
            const submitBtn = document.querySelector('button.submit-btn.register-btn') || 
                              document.querySelector('button.register-btn') ||
                              Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Đăng ký'));

            if (submitBtn) {
                submitBtn.click();
                appendLog("Hành động", "Đã bấm Đăng ký! Đang chờ Captcha xuất hiện...");
                updateBadge('Đã bấm ĐK', '#10b981');
            } else {
                appendLog("Lỗi", "Không tìm thấy nút đăng ký!");
                updateBadge('Lỗi nút', '#ef4444');
            }

            unlockTimer = setTimeout(() => { isSubmitting = false; }, 2000);
        }, 800);
    }

    function stopAllActions() {
        if (submitTimer) clearTimeout(submitTimer);
        if (unlockTimer) clearTimeout(unlockTimer);
        isSubmitting = false;
        isProcessingCaptcha = false;
        isWaitingForPostAction = false;
        lastProcessedBg = '';
        captchaRetryCount = 0;
        updateBadge('Đã dừng', '#ef4444');
        appendLog("Dừng", "Đã hủy toàn bộ quy trình.");
    }

    function imageUrlToBase64(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "blob",
                onload: function (response) {
                    const reader = new FileReader();
                    reader.onloadend = function () { resolve(reader.result.split(',')[1]); };
                    reader.onerror = () => reject(new Error('Lỗi convert Base64 blob'));
                    reader.readAsDataURL(response.response);
                },
                onerror: () => reject(new Error('Lỗi mạng tải ảnh'))
            });
        });
    }

    function createTask(base64, widthView, heightView) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.omocaptcha.com/v2/createTask",
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    clientKey: CONFIG.apiKey,
                    task: { type: "SliderAllWebTask", imageBase64: base64, widthView: Math.round(widthView) || 300, heightView: Math.round(heightView) || 150 }
                }),
                onload: function (response) {
                    try {
                        const res = JSON.parse(response.responseText);
                        if (res.errorId === 0 && res.taskId) resolve(res.taskId);
                        else reject(new Error(res.errorDescription || `Lỗi OMO tạo task`));
                    } catch (e) { reject(new Error('Lỗi parse JSON createTask')); }
                },
                onerror: () => reject(new Error('Lỗi kết nối API OMO createTask'))
            });
        });
    }

    function getTaskResult(taskId) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (attempts > 30) { clearInterval(timer); reject(new Error('Quá thời gian chờ giải OMO')); return; }

                GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://api.omocaptcha.com/v2/getTaskResult",
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({ clientKey: CONFIG.apiKey, taskId: taskId }),
                    onload: function (response) {
                        try {
                            const res = JSON.parse(response.responseText);
                            if (res.errorId === 0) {
                                if (res.status === "ready") { clearInterval(timer); resolve(res.solution); }
                                else if (res.status === "fail") { clearInterval(timer); reject(new Error('Giải thất bại')); }
                            } else { clearInterval(timer); reject(new Error(res.errorDescription || 'Lỗi API getTaskResult')); }
                        } catch (e) { clearInterval(timer); reject(new Error('Lỗi parse JSON')); }
                    },
                    onerror: () => { clearInterval(timer); reject(new Error('Mất kết nối mạng OMO')); }
                });
            }, 1800);
        });
    }

    function clickReloadCaptcha() {
        const reloadBtn = document.querySelector('.botion_reload_8b7ae077') || document.querySelector('[class*="reload"]');
        if (reloadBtn) { reloadBtn.click(); return true; }
        return false;
    }

    async function simulateDrag(sliderBtn, distanceX) {
        const box = sliderBtn.getBoundingClientRect();
        const startX = box.left + box.width / 2;
        const startY = box.top + box.height / 2;
        const finalDistanceX = distanceX - 16;
        const targetX = startX + finalDistanceX;

        function fireEvent(type, x, y) {
            const pointerType = type.startsWith('pointer') ? type : (type === 'mousedown' ? 'pointerdown' : (type === 'mousemove' ? 'pointermove' : 'pointerup'));
            sliderBtn.dispatchEvent(new PointerEvent(pointerType, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }));
            const mouseType = type.startsWith('touch') ? (type === 'touchstart' ? 'mousedown' : 'mousemove') : type;
            sliderBtn.dispatchEvent(new MouseEvent(mouseType, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
        }

        fireEvent('mousedown', startX, startY);
        await new Promise(r => setTimeout(r, 60));

        const steps = 25;
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const currentX = startX + (finalDistanceX * Math.sin((progress * Math.PI) / 2));
            fireEvent('mousemove', currentX, startY);
            await new Promise(r => setTimeout(r, 15));
        }
        fireEvent('mouseup', targetX, startY);
    }

    async function processCaptcha() {
        if (isProcessingCaptcha) return;

        const bgDiv = document.querySelector('.botion_bg_8b7ae077') || document.querySelector('[class*="botion_bg"]');
        const sliderBtn = document.querySelector('.botion_btn_8b7ae077') || document.querySelector('[class*="botion_btn"]');

        if (!bgDiv || !sliderBtn || bgDiv.offsetParent === null) return;

        const bgStyle = window.getComputedStyle(bgDiv).backgroundImage;
        const match = bgStyle.match(/url\(["']?(.*?)["']?\)/);
        if (!match || !match[1]) return;

        const bgUrl = match[1];
        if (bgUrl === lastProcessedBg) return;

        isProcessingCaptcha = true;
        lastProcessedBg = bgUrl;

        try {
            updateBadge('Bắt captcha...', '#a855f7');
            const bgRect = bgDiv.getBoundingClientRect();
            const base64 = await imageUrlToBase64(bgUrl);
            const taskId = await createTask(base64, bgRect.width || 300, bgRect.height || 150);
            const solution = await getTaskResult(taskId);

            const targetX = solution.rects?.[0]?.x || solution.end?.x || 0;
            const trackWidth = sliderBtn.parentElement?.getBoundingClientRect().width || bgRect.width;
            const dragDistance = (targetX * ((trackWidth - sliderBtn.getBoundingClientRect().width) / (bgRect.width - sliderBtn.getBoundingClientRect().width))) - 2;

            updateBadge('Đang trượt...', '#f59e0b');
            await simulateDrag(sliderBtn, dragDistance);
            
            updateBadge('Giải xong!', '#10b981');
            captchaRetryCount = 0;

            setTimeout(() => {
                isProcessingCaptcha = false;
                if (!isWaitingForPostAction) {
                    startPostCaptchaFlow();
                }
            }, 1500);

        } catch (err) {
            console.error('[Captcha Error]', err);
            appendLog("Lỗi Captcha", err.message);
            captchaRetryCount++;

            if (captchaRetryCount <= MAX_CAPTCHA_RETRIES) {
                updateBadge(`Thử lại ${captchaRetryCount}`, '#ef4444');
                clickReloadCaptcha();
                lastProcessedBg = '';
                setTimeout(() => { isProcessingCaptcha = false; }, 1500);
            } else {
                isProcessingCaptcha = false;
                updateBadge('Hết lượt thử', '#ef4444');
            }
        }
    }

    function triggerRealClick(element) {
        if (!element) return;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
            element.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
        });
        if (typeof element.click === 'function') element.click();
    }

    function startPostCaptchaFlow() {
        isWaitingForPostAction = true;
        updateBadge('Đợi nút Rút...', '#3b82f6');
        appendLog("Quy trình", "Đang quét tìm nút 'Rút'...");

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const spans = Array.from(document.querySelectorAll('span, div'));
            const withdrawBtn = spans.find(el => el.innerText && el.innerText.trim() === 'Rút' && el.offsetParent !== null);

            if (withdrawBtn) {
                clearInterval(timer);
                appendLog("Quy trình", "Đã tìm thấy nút 'Rút' -> CLICK!");
                triggerRealClick(withdrawBtn);
                waitForPlusButton();
            } else if (attempts > 25) {
                clearInterval(timer);
                isWaitingForPostAction = false;
                updateBadge('Hết giờ Rút', '#ef4444');
            }
        }, 1000);
    }

    function waitForPlusButton() {
        updateBadge('Đợi dấu (+)...', '#f59e0b');
        appendLog("Quy trình", "Đang chờ mở form để bấm 'Dấu (+) Đỏ'...");

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const plusBtn = document.querySelector('.withdraw-bkadd') || document.querySelector('[class*="withdraw-bkadd"]');

            if (plusBtn) {
                clearInterval(timer);
                appendLog("Quy trình", "Đã tìm thấy Dấu (+) Đỏ -> CLICK!");
                triggerRealClick(plusBtn);
                waitForArrowAndSelectBank();
            } else if (attempts > 20) {
                clearInterval(timer);
                isWaitingForPostAction = false;
                updateBadge('Không thấy (+)', '#ef4444');
            }
        }, 800);
    }

    function waitForArrowAndSelectBank() {
        updateBadge('Chọn Ngân Hàng...', '#8b5cf6');
        appendLog("Quy trình", "Đang tìm mũi tên chọn ngân hàng...");

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const arrowBtn = document.querySelector('.inputIcon.icon-down') || 
                             document.querySelector('div.inputIcon[class*="icon-down"]') || 
                             document.querySelector('svg.am-icon-downArrows_cff85593')?.closest('div') ||
                             document.querySelector('[class*="icon-down"]');

            if (arrowBtn) {
                clearInterval(timer);
                appendLog("Quy trình", "Đã tìm thấy mũi tên chọn Bank -> Mở danh sách!");
                triggerRealClick(arrowBtn);

                setTimeout(selectTargetBankItem, 600);
            } else if (attempts > 25) {
                clearInterval(timer);
                isWaitingForPostAction = false;
                updateBadge('Không thấy mũi tên', '#ef4444');
            }
        }, 800);
    }

    function selectTargetBankItem() {
        let attempts = 0;
        const targetBankName = CONFIG.selectedBank.trim().toLowerCase();
        appendLog("Chọn Bank", `Đang tìm kiếm ngân hàng: [${CONFIG.selectedBank}] trong danh sách...`);

        const bankTimer = setInterval(() => {
            attempts++;
            const bankItems = document.querySelectorAll('.am-list-content');
            
            let foundItem = null;
            for (const item of bankItems) {
                if (item.innerText && item.innerText.trim().toLowerCase() === targetBankName) {
                    foundItem = item;
                    break;
                }
            }

            if (foundItem) {
                clearInterval(bankTimer);
                appendLog("Hoàn tất", `Đã chọn thành công ngân hàng: ${foundItem.innerText.trim()}`);
                updateBadge('Điền thông tin...', '#3b82f6');
                triggerRealClick(foundItem);

                setTimeout(fillBankDetailsForm, 800);
            } else if (attempts > 20) {
                clearInterval(bankTimer);
                isWaitingForPostAction = false;
                updateBadge('Lỗi chọn Bank', '#ef4444');
            }
        }, 600);
    }

    function fillBankDetailsForm() {
        appendLog("Điền Form", "Đang tiến hành điền Số Tài Khoản, Chi nhánh, Mật khẩu rút tiền và bấm Xác nhận...");

        const stkInputEl = document.getElementById('ui-stk');
        const customStk = stkInputEl ? stkInputEl.value.trim() : CONFIG.bankAccountNum;
        currentRegInfo.stk = customStk;

        const stkInput = document.querySelector('input[name="bankCard"]') || 
                         document.querySelector('input[placeholder*="số tài khoản"]');
        if (stkInput) {
            setInputValue(stkInput, customStk);
            appendLog("Điền STK", `Đã điền số tài khoản: ${customStk}`);
        } else {
            appendLog("Cảnh báo", "Không tìm thấy ô nhập Số tài khoản.");
        }

        const randomBranch = BRANCH_LIST[Math.floor(Math.random() * BRANCH_LIST.length)];
        const branchInput = document.querySelector('input[name="customBankBranch"]') || 
                            document.querySelector('input[placeholder*="Chi nhánh"]');
        if (branchInput) {
            setInputValue(branchInput, randomBranch);
            appendLog("Điền Chi Nhánh", `Đã điền chi nhánh ngẫu nhiên: ${randomBranch}`);
        } else {
            appendLog("Cảnh báo", "Không tìm thấy ô nhập Chi nhánh mở tài khoản.");
        }

        const passwordInputs = document.querySelectorAll('input[type="password"]');
        if (passwordInputs.length >= 2) {
            setInputValue(passwordInputs[0], '123456');
            setInputValue(passwordInputs[1], '123456');
            appendLog("Điền Mật Khẩu", "Đã điền mật khẩu rút tiền 123456 vào cả 2 ô thành công!");
        } else {
            const passInputs = Array.from(document.querySelectorAll('input')).filter(el => {
                const ph = (el.placeholder || '').toLowerCase();
                return ph.includes('mật khẩu');
            });
            if (passInputs.length >= 2) {
                setInputValue(passInputs[0], '123456');
                setInputValue(passInputs[1], '123456');
                appendLog("Điền Mật Khẩu", "Đã điền mật khẩu 123456 qua fallback placeholder.");
            } else {
                appendLog("Cảnh báo", "Không tìm đủ 2 ô nhập mật khẩu rút tiền.");
            }
        }

        setTimeout(clickConfirmButton, 1000);
    }

    function clickConfirmButton() {
        updateBadge('Bấm Xác Nhận...', '#f59e0b');
        appendLog("Xác Nhận", "Đang tìm nút Xác Nhận Form (.am-button.btn-success)...");

        let attempts = 0;
        const confirmTimer = setInterval(() => {
            attempts++;
            const confirmBtn = document.querySelector('.am-button.btn-success') || 
                               Array.from(document.querySelectorAll('span, button, div')).find(el => el.innerText && el.innerText.trim().toLowerCase() === 'xác nhận' && el.offsetParent !== null);

            if (confirmBtn) {
                clearInterval(confirmTimer);
                appendLog("Xác Nhận", "Đã bấm nút 'Xác nhận' form -> Chờ Popup xác nhận xuất hiện...");
                updateBadge('Chờ Popup...', '#8b5cf6');
                triggerRealClick(confirmBtn);

                setTimeout(clickPopupConfirmButton, 1000);
            } else if (attempts > 20) {
                clearInterval(confirmTimer);
                isWaitingForPostAction = false;
                appendLog("Lỗi", "Không tìm thấy nút 'Xác nhận' form.");
                updateBadge('Lỗi Xác Nhận', '#ef4444');
            }
        }, 600);
    }

    function clickPopupConfirmButton() {
        updateBadge('Xác Nhận Popup...', '#f59e0b');
        appendLog("Popup", "Đang quét tìm nút 'Xác nhận' màu xanh dương trên popup thông báo...");

        let attempts = 0;
        const popupTimer = setInterval(() => {
            attempts++;
            
            const allEls = Array.from(document.querySelectorAll('div, span, button, a'));
            let popupBtn = allEls.find(el => {
                const text = (el.innerText || '').trim().toLowerCase();
                if (text !== 'xác nhận' || el.offsetParent === null) return false;
                
                const rect = el.getBoundingClientRect();
                return rect.left > window.innerWidth / 2 && !el.className.includes('btn-success');
            });

            if (!popupBtn) {
                popupBtn = Array.from(document.querySelectorAll('div, span, button, a')).find(el => {
                    const text = (el.innerText || '').trim().toLowerCase();
                    const rect = el.getBoundingClientRect();
                    return text === 'xác nhận' && el.offsetParent !== null && rect.width > 30 && rect.left > window.innerWidth / 2;
                });
            }

            if (popupBtn) {
                clearInterval(popupTimer);
                appendLog("Hoàn tất", "Đã tìm thấy nút 'Xác nhận' xanh dương trên Popup -> CLICK LẦN 1!");
                updateBadge('Click popup 1', '#10b981');
                triggerRealClick(popupBtn);

                setTimeout(() => {
                    appendLog("Hoàn tất", "Đang thực hiện CLICK LẦN 2 vào nút Xác Nhận xanh dương trên Popup. Hoàn tất quy trình!");
                    triggerRealClick(popupBtn);
                    updateBadge('Hoàn tất 100%', '#10b981');
                    isWaitingForPostAction = false;

                    // Gửi thông tin tài khoản qua Telegram với thông số mới
                    sendTelegramNotification("Đã hoàn tất quy trình liên kết ngân hàng thành công!");

                }, 300);

            } else if (attempts > 25) {
                clearInterval(popupTimer);
                isWaitingForPostAction = false;
                appendLog("Cảnh báo", "Không tìm thấy nút Xác nhận màu xanh dương trên Popup.");
                updateBadge('Không thấy Popup', '#ef4444');
            }
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }
})();
