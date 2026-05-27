//script.js

/***** ログ処理 *****/
function addLog(message) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const logArea = document.getElementById("logArea");
  logArea.innerText += `[${time}] ${message}\n`;
  logArea.scrollTop = logArea.scrollHeight;
}

/***** localStorage 関連 *****/
function saveInput(id) {
  const el = document.getElementById(id);
  if(el) localStorage.setItem(id, el.value);
}
function loadInput(id) {
  const el = document.getElementById(id);
  const saved = localStorage.getItem(id);
  if (el && saved !== null) {
    el.value = saved;
  }
}
function saveCheckbox(id) {
  const el = document.getElementById(id);
  if(el) localStorage.setItem(id, el.checked);
}
function loadCheckbox(id) {
  const el = document.getElementById(id);
  const saved = localStorage.getItem(id);
  if (el && saved !== null) {
    el.checked = (saved === "true");
  }
}
function saveAccordionState(id, isOpen) {
  localStorage.setItem("accordion-" + id, isOpen);
}
function loadAccordionState(id) {
  const saved = localStorage.getItem("accordion-" + id);
  return saved === "true";
}
window.addEventListener("load", () => {
  loadInput("global-token");
  loadInput("dm-channelId");
  loadInput("server-guildId");
  loadInput("server-channelIds");
  loadCheckbox("dm-all");
  updateDMChannelVisibility();
});
document.getElementById("global-token").addEventListener("input", () => { saveInput("global-token"); });
document.getElementById("dm-channelId").addEventListener("input", () => { saveInput("dm-channelId"); });
document.getElementById("server-guildId").addEventListener("input", () => { saveInput("server-guildId"); });
document.getElementById("server-channelIds").addEventListener("input", () => { saveInput("server-channelIds"); });
document.getElementById("dm-all").addEventListener("change", () => {
  saveCheckbox("dm-all");
  updateDMChannelVisibility();
});
function updateDMChannelVisibility() {
  const dmAll = document.getElementById("dm-all").checked;
  const container = document.getElementById("dm-channel-container");
  container.style.display = dmAll ? "none" : "block";
}

/***** 非同期スリープ *****/
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(error) {
  const headers = error.response?.headers || {};
  const data = error.response?.data || {};
  const retryAfterHeader = headers['retry-after'] || headers['Retry-After'];
  if (retryAfterHeader) {
    const seconds = parseFloat(retryAfterHeader);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const parsedDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(parsedDate)) {
      return Math.max(0, parsedDate - Date.now());
    }
  }
  const retryAfterData = data.retry_after ?? data['retry_after'];
  if (retryAfterData != null) {
    const seconds = parseFloat(retryAfterData);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, seconds * 1000);
    }
  }
  const retryAfterMsData = data.retry_after_ms ?? data['retry_after_ms'];
  if (retryAfterMsData != null) {
    const milliseconds = parseFloat(retryAfterMsData);
    if (!Number.isNaN(milliseconds)) {
      return Math.max(0, milliseconds);
    }
  }
  const reset = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];
  if (reset) {
    const resetSeconds = parseFloat(reset);
    if (!Number.isNaN(resetSeconds)) {
      return Math.max(0, (resetSeconds * 1000) - Date.now());
    }
  }
  return null;
}

async function axiosRequestWithRateLimit(config, description, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios(config);
    } catch (error) {
      if (error.response?.status === 429 && attempt < maxRetries) {
        const waitMs = parseRetryAfterMs(error);
        if (waitMs === null) {
          addLog(`${description} にてレートリミットに到達しましたが待機時間を取得できませんでした。1秒待機して再試行します。`);
          await sleep(1000);
        } else {
          const waitSec = (waitMs / 1000).toFixed(3).replace(/\.0+$|(?<=\d)0+$/, '');
          addLog(`${description} にてレートリミットに到達しました。${waitSec}秒待機して再試行します。`);
          await sleep(waitMs);
        }
        continue;
      }
      throw error;
    }
  }
  return await axios(config);
}

/***** 共通: グローバルトークン取得 *****/
function getGlobalToken() {
  return document.getElementById("global-token").value.trim();
}

function copyLogToClipboard() {
  const logArea = document.getElementById("logArea");
  const text = logArea.innerText;
  if (!text) {
    addLog("ログが空のため、コピーできませんでした。");
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    addLog("ログをコピーしました。");
  }).catch((error) => {
    addLog("ログコピーに失敗しました: " + (error?.message || error));
  });
}

function normalizeMessageEntry(entry) {
  if (Array.isArray(entry) && entry.length > 0) {
    entry = entry[0];
  }
  if (entry && typeof entry === 'object') {
    return entry;
  }
  return null;
}

function isRealUserMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return false;
  }
  const msgType = Number(msg.type ?? 0);
  const typeOk = msgType === 0 || msgType === 19;
  const isBot = msg.author?.bot === true;
  const isWebhook = msg.webhook_id != null;
  return typeOk && !isBot && !isWebhook;
}

function extractMessagesFromTabs(tabs) {
  const messagesObj = tabs?.messages;
  if (!messagesObj) {
    return { messages: [], totalResults: 0 };
  }
  const rawMessages = messagesObj.messages || [];
  const messages = rawMessages
    .map(normalizeMessageEntry)
    .filter((msg) => msg && msg.id);
  const totalResults = messagesObj.total_results ?? tabs.total_results ?? 0;
  return { messages, totalResults };
}

async function deleteMessagesInChannel(channelId, token, myUserId, statusElement) {
  let channelDeleted = 0;
  addLog(`DMチャンネル ${channelId} のメッセージ削除開始`);

  while (true) {
    let deletedInThisRound = 0;
    let hasMore = true;
    let offset = 0;
    const endpoint = `https://discord.com/api/v9/channels/${channelId}/messages/search`;

    while (hasMore) {
      let response;
      try {
        response = await axiosRequestWithRateLimit({
          method: 'get',
          url: endpoint,
          headers: { Authorization: token },
          params: {
            author_id: myUserId,
            author_type: 'user',
            sort_by: 'timestamp',
            sort_order: 'desc',
            offset: offset
          }
        }, `DMメッセージ検索 (${channelId}) offset=${offset}`);
      } catch (error) {
        addLog(`メッセージ検索エラー (channel ${channelId}): ` + error);
        statusElement.textContent = `メッセージ検索エラー (channel ${channelId})`;
        break;
      }

      const messages = response.data.messages?.flat() || [];
      const normalizedMessages = messages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
      const totalResults = response.data.total_results || 0;
      addLog(`取得メッセージ数: ${normalizedMessages.length}, 合計: ${totalResults}, offset: ${offset}`);

      if (normalizedMessages.length === 0) {
        if (offset + 25 >= totalResults) {
          hasMore = false;
          break;
        }
        offset += 25;
        continue;
      }

      for (const message of normalizedMessages) {
        if (!isRealUserMessage(message)) {
          addLog(`システム/特殊/ボット/Webhookメッセージをスキップ: ${message.id} (type=${message.type}, bot=${message.author?.bot}, webhook_id=${message.webhook_id})`);
          continue;
        }
        try {
          await axiosRequestWithRateLimit({
            method: 'delete',
            url: `https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`,
            headers: { Authorization: token }
          }, `DMメッセージ削除 (${message.id})`);
          channelDeleted++;
          deletedInThisRound++;
          statusElement.textContent = `削除中… (${channelDeleted} 件削除)`;
          await sleep(500);
        } catch (error) {
          if (error.response?.status === 403) {
            addLog(`削除不可（権限/システム）: ${message.id} | ${error.response?.data?.message || error.message}`);
          } else {
            addLog(`削除失敗: ${message.id} | Status: ${error.response?.status} | ${error.response?.data?.message || error.message}`);
          }
        }
      }

      offset += 25;
      if (offset >= totalResults) {
        hasMore = false;
      }
    }

    if (deletedInThisRound === 0) {
      addLog(`DMチャンネル ${channelId} のこのラウンドでは削除対象メッセージが見つかりませんでした。残り確認を行います。`, 'warning');
    }

    // 残りのメッセージがあるか確認
    let checkOffset = 0;
    let remainingTotalResults = 0;
    let foundRemainingUserMessage = false;
    while (true) {
      let remainingResponse;
      try {
        remainingResponse = await axiosRequestWithRateLimit({
          method: 'get',
          url: endpoint,
          headers: { Authorization: token },
          params: {
            author_id: myUserId,
            author_type: 'user',
            sort_by: 'timestamp',
            sort_order: 'desc',
            offset: checkOffset
          }
        }, `DMメッセージ残数確認 (${channelId}) offset=${checkOffset}`);
      } catch (error) {
        addLog(`残数確認エラー (channel ${channelId}): ` + error);
        foundRemainingUserMessage = true;
        break;
      }

      const remainingMessages = remainingResponse.data.messages?.flat() || [];
      const normalizedRemaining = remainingMessages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
      remainingTotalResults = remainingResponse.data.total_results || 0;
      if (normalizedRemaining.some(isRealUserMessage)) {
        foundRemainingUserMessage = true;
        break;
      }

      checkOffset += 25;
      if (checkOffset >= remainingTotalResults || remainingTotalResults === 0) {
        break;
      }
    }

    if (!foundRemainingUserMessage) {
      addLog(`DMチャンネル ${channelId} の削除完了`);
      break;
    }

    if (deletedInThisRound === 0) {
      addLog(`${remainingTotalResults} 件のメッセージが残っていますが、今回削除できるメッセージはありませんでした。処理を終了します。`);
      break;
    }

    addLog(`${remainingTotalResults} 件のメッセージが残っています。再試行します。`);
    await sleep(1000);
  }

  return channelDeleted;
}

/***** DMメッセージ削除処理（改良版） *****/
async function deleteDMMessages() {
  const token = getGlobalToken();
  const statusElement = document.getElementById("dm-status");
  if (!token) {
    statusElement.textContent = "Bot Tokenを入力してください。";
    addLog("Bot Token未入力 (DM)");
    return;
  }

  // 「すべてのDMを削除する」チェックボックスの状態を取得
  const dmAll = document.getElementById("dm-all").checked;
  let channelIds = [];
  if (dmAll) {
    addLog("全DMチャンネルを取得中...");
    // 全DMチャンネル一覧を取得
    try {
      const res = await axiosRequestWithRateLimit({
        method: 'get',
        url: "https://discord.com/api/v9/users/@me/channels",
        headers: { Authorization: token }
      }, 'DMチャンネル一覧取得');
      channelIds = res.data.filter(c => c.type === 1 || c.type === 3).map(c => c.id); // type 1: DM, type 3: Group DM
      addLog(`取得したDMチャンネル数: ${channelIds.length}`);
    } catch (error) {
      statusElement.textContent = "DMチャンネル一覧取得失敗";
      addLog("DMチャンネル一覧取得失敗: " + error);
      return;
    }
    if (channelIds.length === 0) {
      statusElement.textContent = "DMチャンネルが見つかりません。";
      addLog("DMチャンネルが見つかりません");
      return;
    }
  } else {
    const channelId = document.getElementById("dm-channelId").value.trim();
    if (!channelId) {
      statusElement.textContent = "DMチャンネルIDを入力してください。";
      addLog("DMチャンネルID未入力");
      return;
    }
    channelIds = [channelId];
  }

  // 自分のユーザーID取得
  let myUserId;
  try {
    const meRes = await axiosRequestWithRateLimit({
      method: 'get',
      url: "https://discord.com/api/v9/users/@me",
      headers: { Authorization: token }
    }, 'ユーザーID取得');
    myUserId = meRes.data.id;
  } catch (error) {
    statusElement.textContent = "ユーザーID取得失敗";
    addLog("ユーザーID取得失敗: " + error);
    return;
  }

  let totalDeleted = 0;
  
  if (dmAll) {
    for (const channelId of channelIds) {
      totalDeleted += await deleteMessagesInChannel(channelId, token, myUserId, statusElement);
    }
  } else {
    // 特定チャンネルのメッセージのみ削除
    for (const channelId of channelIds) {
      addLog(`DMチャンネル ${channelId} のメッセージ削除開始`);
      // 外側ループ：メッセージがなくなるまで繰り返す
      while (true) {
        let hasMore = true;
        let offset = 0;
        const endpoint = `https://discord.com/api/v9/channels/${channelId}/messages/search`;
        let deletedInThisRound = 0;
        
        while (hasMore) {
          let response;
          try {
            response = await axiosRequestWithRateLimit({
              method: 'get',
              url: endpoint,
              headers: { Authorization: token },
              params: {
                author_id: myUserId,
                author_type: 'user',
                sort_by: 'timestamp',
                sort_order: 'desc',
                offset: offset
              }
            }, `DMメッセージ検索 (${channelId})`);
          } catch (error) {
            addLog(`メッセージ検索エラー (channel ${channelId}): ` + error);
            statusElement.textContent = `メッセージ検索エラー (channel ${channelId})`;
            break;
          }
          const messages = response.data.messages?.flat() || [];
          const normalizedMessages = messages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
          const totalResults = response.data.total_results || 0;
          addLog(`取得メッセージ数: ${messages.length}, 合計: ${totalResults}`);
          if (normalizedMessages.length === 0) {
            hasMore = false;
            break;
          }
          for (const message of normalizedMessages) {
            if (!isRealUserMessage(message)) {
              addLog(`システム/特殊/ボット/Webhookメッセージをスキップ: ${message.id} (type=${message.type}, bot=${message.author?.bot}, webhook_id=${message.webhook_id})`);
              continue;
            }
            try {
              await axiosRequestWithRateLimit({
                method: 'delete',
                url: `https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`,
                headers: { Authorization: token }
              }, `DMメッセージ削除 (${message.id})`);
              totalDeleted++;
              deletedInThisRound++;
              statusElement.textContent = `削除中… (${totalDeleted} 件削除)`;
              await sleep(500);
            } catch (error) {
              // 403 の場合は削除不可（例: システムメッセージ）としてログに残しスキップ
              if (error.response?.status === 403) {
                addLog(`削除不可（権限/システム）: ${message.id} | ${error.response?.data?.message || error.message}`);
              } else {
                addLog(`削除失敗: ${message.id} | Status: ${error.response?.status} | ${error.response?.data?.message || error.message}`);
              }
            }
          }
          offset += 25;
          if (offset >= totalResults) {
            hasMore = false;
          }
        }
        
        // 残りのメッセージがないか確認
        let remainingResponse;
        try {
          remainingResponse = await axiosRequestWithRateLimit({
            method: 'get',
            url: endpoint,
            headers: { Authorization: token },
            params: {
              author_id: myUserId,
              author_type: 'user',
              sort_by: 'timestamp',
              sort_order: 'desc',
              offset: 0
            }
          }, `DMメッセージ残数確認 (${channelId})`);
        } catch (error) {
          addLog(`残数確認エラー (channel ${channelId}): ` + error);
          break;
        }
        
        const remainingMessages = remainingResponse.data.messages?.flat() || [];
        const normalizedRemaining = remainingMessages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
        const remainingCount = normalizedRemaining.filter(isRealUserMessage).length;

        if (remainingCount === 0) {
          addLog(`DMチャンネル ${channelId} の削除完了`);
          break;
        }
        // このラウンドで1件も削除できなかったら無限ループ防止のため終了
        if (deletedInThisRound === 0) {
          addLog(`DMチャンネル ${channelId} に ${remainingCount} 件の削除可能なメッセージが残っていますが、今回削除できませんでした。処理を終了します。`);
          break;
        }
        addLog(`DMチャンネル ${channelId} にまだ ${remainingCount} 件のメッセージがあります。再試行します。`);
      }
    }
  }
  statusElement.textContent = `削除完了: ${totalDeleted} 件`;
  addLog("DM削除完了: " + totalDeleted + "件");
}

/***** サーバーメッセージ削除処理（改良版） *****/
document.getElementById("server-startBtn").addEventListener("click", async () => {
  const token = getGlobalToken();
  const statusElement = document.getElementById("server-status");
  if (!token) {
    statusElement.textContent = "Bot Tokenを入力してください。";
    addLog("Bot Token未入力 (Server)");
    return;
  }
  addLog("サーバーメッセージ削除処理開始");
  let guildIds = [];
  let channelIds = [];
  const guildId = document.getElementById("server-guildId").value.trim();
  if (!guildId) {
    statusElement.textContent = "Guild IDを入力してください。";
    addLog("Guild ID未入力");
    return;
  }
  guildIds.push(guildId);
  const channelsInput = document.getElementById("server-channelIds").value.trim();
  if (channelsInput) {
    channelIds = channelsInput.split("\n").map(line => line.trim()).filter(line => line);
  }
  let AUTHOR_ID;
  try {
    const meResponse = await axiosRequestWithRateLimit({
      method: 'get',
      url: "https://discord.com/api/v9/users/@me",
      headers: { Authorization: token }
    }, 'BotユーザーID取得');
    AUTHOR_ID = meResponse.data.id;
  } catch (error) {
    statusElement.textContent = "BotのユーザーID取得に失敗しました。";
    addLog("ユーザーID取得失敗: " + error);
    return;
  }
  let totalDeleted = 0;
  // 各ギルドについて処理
  for (const guildId of guildIds) {
    if (channelIds.length > 0) {
      for (const channelId of channelIds) {
        while (true) {
          let offset = 0;
          let hasMoreMessages = true;
          let deletedInThisRound = 0;
          const endpoint = `https://discord.com/api/v9/guilds/${guildId}/messages/search`;
          while (hasMoreMessages) {
            let response;
            try {
              response = await axiosRequestWithRateLimit({
                method: 'get',
                url: endpoint,
                headers: { Authorization: token },
                params: { author_id: AUTHOR_ID, offset: offset, channel_id: channelId }
              }, `サーバーメッセージ検索 (${channelId})`);
            } catch (error) {
              addLog("メッセージ検索エラー (Server): " + error);
              hasMoreMessages = false;
              break;
            }
            const messages = response.data.messages?.flat() || [];
            const normalizedMessages = messages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
            const totalResults = response.data.total_results || 0;
            
            if (normalizedMessages.length === 0) { 
              addLog(`Channel ${channelId} のメッセージはもうありません。`);
              hasMoreMessages = false;
              break; 
            }
            for (const message of normalizedMessages) {
              if (message.type !== 0) {
                addLog(`システムメッセージをスキップ: ${message.id}`);
                continue;
              }
              try {
                await axiosRequestWithRateLimit({
                  method: 'delete',
                  url: `https://discord.com/api/v9/channels/${message.channel_id}/messages/${message.id}`,
                  headers: { Authorization: token }
                }, `サーバーメッセージ削除 (${message.id})`);
                totalDeleted++;
                deletedInThisRound++;
                statusElement.textContent = `削除中… (${totalDeleted} 件削除)`;
                await sleep(500);
              } catch (error) {
                addLog(`削除失敗 (Server): ${message.id} | ${error.response?.data || error.message}`);
              }
            }
            offset += 25;
            if (offset >= totalResults) { break; }
          }
          let remainingResponse;
          try {
            remainingResponse = await axiosRequestWithRateLimit({
              method: 'get',
              url: endpoint,
              headers: { Authorization: token },
              params: { author_id: AUTHOR_ID, offset: 0, channel_id: channelId }
            }, `サーバーメッセージ再取得 (${channelId})`);
          } catch (error) {
            addLog("再取得エラー (Server): " + error);
            break;
          }
          const remainingMessages = remainingResponse.data.messages?.flat() || [];
          const normalizedRemaining = remainingMessages.map(msg => Array.isArray(msg) && msg[0] ? msg[0] : msg).filter(Boolean);
          if (normalizedRemaining.length === 0) {
            addLog(`Channel ${channelId} の全メッセージ削除完了。`);
            break;
          }
          if (deletedInThisRound === 0) {
            addLog(`Channel ${channelId} に ${normalizedRemaining.length} 件のメッセージが残っていますが、削除できるメッセージはありませんでした。処理を終了します。`);
            break;
          }
          addLog(`Channel ${channelId} にまだ ${normalizedRemaining.length} 件のメッセージがあります。再試行します。`);
        }
      }
    }
  }
  statusElement.textContent = `削除完了: ${totalDeleted} 件`;
  addLog("サーバーメッセージ削除完了: " + totalDeleted + "件");
});
