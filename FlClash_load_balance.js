// artuger自用脚本，有针对性，别乱用！！！
// 全局扩展脚本：订阅更新后自动生成「按地区分类的负载均衡」代理组
// Clash Verge Rev 在每次订阅更新 / 切换配置重新生成最终配置时都会执行本脚本，
// 地区分组、节点列表全部自动重建，不会随订阅更新丢失。

const PREFIX = "⚖️ ";                       // 本脚本生成组的统一前缀（幂等清理用）
const HEALTH_URL = "http://www.google.com/generate_204";
const INTERVAL = 300;
const EXCLUDE_RE = new RegExp("官网|邀请|返利|剩余|到期|流量|套餐|重置|过期|失联|检测");

// 地区识别表：按顺序匹配，先中文名后英文/代码（拉丁代码加边界防误伤，仅用前瞻保证跨引擎兼容）
const REGIONS = [
  ["香港", /香港|港|(?:^|[^A-Za-z])HK(?![A-Za-z])|Hong ?Kong/i],
  ["台湾", /台湾|台北|新北|彰化|(?:^|[^A-Za-z])TW(?![A-Za-z])|Taiwan/i],
  ["日本", /日本|东京|大阪|埼玉|名古屋|(?:^|[^A-Za-z])JP(?![A-Za-z])|Japan|Tokyo|Osaka/i],
  ["韩国", /韩国|首尔|春川|(?:^|[^A-Za-z])KR(?![A-Za-z])|Korea|Seoul/i],
  ["新加坡", /新加坡|狮城|(?:^|[^A-Za-z])SG(?![A-Za-z])|Singapore/i],
  ["马来西亚", /马来|大马|(?:^|[^A-Za-z])MY(?![A-Za-z])|Malaysia/i],
  ["泰国", /泰国|曼谷|(?:^|[^A-Za-z])TH(?![A-Za-z])|Thailand|Bangkok/i],
  ["俄罗斯", /俄罗斯|莫斯科|(?:^|[^A-Za-z])RU(?![A-Za-z])|Russia|Moscow/i],
  ["美国", /美国|United ?States|Los ?Angeles|San ?Jose|Seattle|Dallas|Phoenix|Fremont|洛杉矶|圣何塞|西雅图|达拉斯|凤凰城|(?:^|[^A-Za-z])US(?![A-Za-z])/i],
  ["加拿大", /加拿大|温哥华|多伦多|Canada|Vancouver|Toronto/i],
  ["英国", /英国|伦敦|(?:^|[^A-Za-z])UK(?![A-Za-z])|United ?Kingdom|London/i],
  ["德国", /德国|法兰克福|(?:^|[^A-Za-z])DE(?![A-Za-z])|Germany|Frankfurt/i],
  ["法国", /法国|巴黎|(?:^|[^A-Za-z])FR(?![A-Za-z])|France|Paris/i],
  ["荷兰", /荷兰|阿姆斯特丹|(?:^|[^A-Za-z])NL(?![A-Za-z])|Netherlands|Amsterdam/i],
  ["土耳其", /土耳其|伊斯坦布尔|(?:^|[^A-Za-z])TR(?![A-Za-z])|Turkey|Istanbul/i],
  ["印度尼西亚", /印尼|印度尼西亚|雅加达|(?:^|[^A-Za-z])ID(?![A-Za-z])|Indonesia|Jakarta/i],
  ["菲律宾", /菲律宾|(?:^|[^A-Za-z])PH(?![A-Za-z])|Philippines/i],
  ["印度", /印度|孟买|(?:^|[^A-Za-z])IN(?![A-Za-z])|India|Mumbai/i],
  ["澳大利亚", /澳大利亚|澳洲|悉尼|(?:^|[^A-Za-z])AU(?![A-Za-z])|Australia|Sydney/i],
  ["巴西", /巴西|Brazil/i],
  ["阿根廷", /阿根廷|Argentina/i],
];

const isOurs = (name) => String(name).startsWith(PREFIX) || name === "负载均衡";

// ============ 防污染 DNS ============
// 原理：DNS 污染只发生在明文 UDP 53。这里全部使用 IP 直连形式的加密 DoH
// （https://1.1.1.1/... 无需域名引导、内容加密不可污染）；
// 国内域名走国内 DoH 保速度，国外域名走海外 DoH 且 respect-rules 下经代理解析。
// 设为 false 可整体停用（保留订阅自带 DNS）。
const DNS_OVERWRITE = true;
const DNS_CONFIG = {
  enable: true,
  ipv6: false,
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  // 这些域名返回真实 IP，避免 NTP/局域网发现/游戏平台被假 IP 弄坏
  "fake-ip-filter": [
    "*.lan", "*.local", "*.arpa",
    "time.*.com", "ntp.*.com", "+.pool.ntp.org", "time.*.apple.com",
    "+.msftconnecttest.com", "+.msftncsi.com",
    "localhost.ptlogin2.qq.com", "+.market.xiaomi.com",
    "+.stun.*.*", "+.stun.*.*.*", "+.stun.*.*.*.*",
    "WORKGROUP",
  ],
  "use-hosts": true,
  "respect-rules": true,   // 对 DNS 服务器自身的查询也按分流规则走（1.1.1.1 自动经代理）
  // 引导用：明文国内 IP，仅解析 DoH 域名时兜底（本配置 DoH 均为 IP 直连形式，几乎用不到）
  "default-nameserver": ["223.5.5.5", "119.29.29.29"],
  // 解析订阅节点域名：必须国内直连可达
  "proxy-server-nameserver": ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"],
  // 国外域名：IP 直连式加密 DoH，防污染
  nameserver: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
  // 国内域名：国内 DoH，快且结果准确
  "nameserver-policy": {
    "geosite:private": ["223.5.5.5", "119.29.29.29"],
    "geosite:cn": ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"],
  },
};

function applyDNS(config) {
  if (!DNS_OVERWRITE) return;
  // 与订阅自带 dns 逐键合并：脚本配置优先，订阅多余的键保留
  config.dns = Object.assign({}, config.dns || {}, DNS_CONFIG);
}
// ====== 防污染 DNS 结束 ======

function mkLB(name, strategy, nodes) {
  return {
    name: PREFIX + name,
    type: "load-balance",
    strategy: strategy,
    url: HEALTH_URL,
    interval: INTERVAL,
    "max-failed-times": 2,
    proxies: nodes,
  };
}

function main(config, profileName) {
  if (!Array.isArray(config["proxy-groups"])) return config;

  // 幂等清理：移除上次生成的组（含旧版「负载均衡」）及各选择组里的引用
  config["proxy-groups"] = config["proxy-groups"].filter(g => !isOurs(g.name));
  for (const g of config["proxy-groups"]) {
    if (Array.isArray(g.proxies)) {
      g.proxies = g.proxies.filter(n => !isOurs(n));
    }
  }

  const realNodes = (config.proxies || [])
    .map(p => p.name)
    .filter(n => !EXCLUDE_RE.test(n));
  if (realNodes.length < 2) return config;

  // 全局组：散列（最优，同一站点固定走同一节点）+ 轮询
  const groups = [
    mkLB("负载均衡-散列", "consistent-hashing", realNodes),
    mkLB("负载均衡-轮询", "round-robin", realNodes),
  ];

  // 按地区归类
  const byRegion = new Map();
  for (const n of realNodes) {
    let hit = "其他";
    for (const [region, re] of REGIONS) {
      if (re.test(n)) { hit = region; break; }
    }
    if (!byRegion.has(hit)) byRegion.set(hit, []);
    byRegion.get(hit).push(n);
  }

  // 命名地区且节点数 ≥2 才建散列负载均衡组（单节点地区无均衡意义；
  // 「其他」是跨地区单节点杂集，混跑会随机出不同国家，也跳过）
  const regionEntries = [...byRegion.entries()]
    .filter(([region, nodes]) => region !== "其他" && nodes.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  const options = [PREFIX + "负载均衡-散列", PREFIX + "负载均衡-轮询"];
  for (const [region, nodes] of regionEntries) {
    groups.push(mkLB("散列-" + region, "consistent-hashing", nodes));
    options.push(PREFIX + "散列-" + region);
  }

  // 汇总选择组：一个入口切换 全局散列/轮询/各地区
  const parent = { name: PREFIX + "负载均衡", type: "select", proxies: options };

  // 挂进第一个手动选择组，组本身插在其后
  const firstSelect = config["proxy-groups"].find(
    g => String(g.type).toLowerCase() === "select"
  );
  const idx = firstSelect ? config["proxy-groups"].indexOf(firstSelect) : 0;
  config["proxy-groups"].splice(idx + 1, 0, parent, ...groups);

  if (firstSelect && Array.isArray(firstSelect.proxies)) {
    let pos = 1;
    for (let i = 1; i < firstSelect.proxies.length; i++) {
      if (/自动|auto|url-?test|故障|fallback|负载/i.test(String(firstSelect.proxies[i]))) {
        pos = i + 1;
      }
    }
    firstSelect.proxies.splice(pos, 0, PREFIX + "负载均衡");
  }

  applyDNS(config);   // 防污染 DNS（含 fake-ip 白名单、加密 DoH、国内外分流）
  return config;
}
