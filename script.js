//script.js

/***** ログ処理 *****/
function addLog(message) {
  const now = new Date().toLocaleTimeString();
  const logArea = document.getElementById("logArea");
  logArea.innerText += `[${now}] ${message}\n`;
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
/***** 共通: グローバルトークン取得 *****/
function getGlobalToken() {
  return document.getElementById("global-token").value.trim();
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
      const res = await axios.get("https://discord.com/api/v9/users/@me/channels", {
        headers: { Authorization: token }
      });
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
    const meRes = await axios.get("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: token }
    });
    myUserId = meRes.data.id;
  } catch (error) {
    statusElement.textContent = "ユーザーID取得失敗";
    addLog("ユーザーID取得失敗: " + error);
    return;
  }

  let totalDeleted = 0;
  for (const channelId of channelIds) {
    addLog(`DMチャンネル ${channelId} のメッセージ削除開始`);
    let hasMore = true;
    let lastMessageId = undefined;
    while (hasMore) {
      let response;
      try {
        response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
          headers: { Authorization: token },
          params: lastMessageId ? { before: lastMessageId, limit: 100 } : { limit: 100 }
        });
      } catch (error) {
        addLog(`メッセージ取得エラー (channel ${channelId}): ` + error);
        statusElement.textContent = `メッセージ取得エラー (channel ${channelId})`;
        break;
      }
      const messages = response.data;
      if (!Array.isArray(messages) || messages.length === 0) {
        hasMore = false;
        break;
      }
      // 自分のメッセージのみ削除
      const myMessages = messages.filter(msg => msg.author && msg.author.id === myUserId);
      for (const message of myMessages) {
        try {
          await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
            headers: { Authorization: token }
          });
          totalDeleted++;
          statusElement.textContent = `削除中… (${totalDeleted} 件削除)`;
          await sleep(500);
        } catch (error) {
          addLog(`削除失敗: ${message.id} ${error.response?.data || error.message}`);
        }
      }
      lastMessageId = messages[messages.length - 1].id;
    }
    addLog(`DMチャンネル ${channelId} の削除完了`);
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
    const meResponse = await axios.get("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: token }
    });
    AUTHOR_ID = meResponse.data.id;
  } catch (error) {
    statusElement.textContent = "BotのユーザーID取得に失敗しました。";
    addLog("ユーザーID取得失敗: " + error);
    console.error(error);
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
          const endpoint = `https://discord.com/api/v9/guilds/${guildId}/messages/search`;
          while (hasMoreMessages) {
            let response;
            try {
              response = await axios.get(endpoint, {
                headers: { Authorization: token },
                params: { author_id: AUTHOR_ID, offset: offset, channel_id: channelId }
              });
            } catch (error) {
              addLog("メッセージ検索エラー (Server): " + error);
              console.error(error);
              hasMoreMessages = false;
              break;
            }
            const messages = response.data.messages.flat();
            const totalResults = response.data.total_results;
            console.log(`Total messages in server: ${totalResults}`);
            console.log(`Current offset: ${offset}`);
            console.log(`Messages fetched: ${messages.length}`);
            if (messages.length === 0) { 
              addLog(`Channel ${channelId} のメッセージはもうありません。`);
              hasMoreMessages = false;
              break; 
            }
            for (const message of messages) {
              try {
                await axios.delete(`https://discord.com/api/v9/channels/${message.channel_id}/messages/${message.id}`, {
                  headers: { Authorization: token }
                });
                console.log(`Deleted message ID: ${message.id}`);
                totalDeleted++;
                statusElement.textContent = `削除中… (${totalDeleted} 件削除)`;
                await sleep(500);
              } catch (error) {
                console.error(`削除失敗 (Server): ${message.id}`, error.response?.data || error.message);
              }
            }
            offset += 25;
            if (offset >= totalResults) { break; }
          }
          let remainingResponse;
          try {
            remainingResponse = await axios.get(endpoint, {
              headers: { Authorization: token },
              params: { author_id: AUTHOR_ID, offset: 0, channel_id: channelId }
            });
          } catch (error) {
            addLog("再取得エラー (Server): " + error);
            console.error(error);
            break;
          }
          const remainingMessages = remainingResponse.data.messages.flat();
          if (remainingMessages.length === 0) {
            addLog(`Channel ${channelId} の全メッセージ削除完了。`);
            break;
          } else {
            addLog(`Channel ${channelId} にまだ ${remainingMessages.length} 件のメッセージがあります。再試行します。`);
          }
        }
      }
    }
  }
  statusElement.textContent = `削除完了: ${totalDeleted} 件`;
  addLog("サーバーメッセージ削除完了: " + totalDeleted + "件");
});
