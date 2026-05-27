# Conexiones SSH

- **Usuario General (Owner / Despliegues):** `ssh zz@46.225.154.68`
- **Usuario Root (Cambios profundos / Admin):** `ssh root@46.225.154.68`

---

# Historial de Evaluaciones VPS

```dataviewjs
const pages = dv.pages('"04-creation/_web/26-musiki/docs/vps-eval"').sort(p => p.date, "desc");

function createProgressBar(used, total, isPercentage = false, formatLabel = "") {
    let pct = isPercentage ? used : Math.round((used / total) * 100);
    
    let color = "#198754"; // green
    if (pct >= 90) color = "#dc3545"; // red
    else if (pct >= 75) color = "#ffc107"; // yellow

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.gap = "8px";

    const barBg = document.createElement("div");
    barBg.style.width = "80px";
    barBg.style.height = "8px";
    barBg.style.backgroundColor = "#3e4451";
    barBg.style.borderRadius = "4px";
    barBg.style.overflow = "hidden";
    barBg.style.display = "inline-block";

    const barFill = document.createElement("div");
    barFill.style.width = pct + "%";
    barFill.style.backgroundColor = color;
    barFill.style.height = "100%";

    barBg.appendChild(barFill);

    const label = document.createElement("span");
    label.style.fontWeight = "600";
    label.style.fontSize = "0.85em";
    label.textContent = formatLabel || (pct + "%");

    container.appendChild(barBg);
    container.appendChild(label);

    return container;
}

function createStatusBadge(status) {
    const span = document.createElement("span");
    span.style.padding = "3px 8px";
    span.style.borderRadius = "12px";
    span.style.fontWeight = "600";
    span.style.fontSize = "0.75em";
    
    const st = (status || "").toLowerCase();
    if (st === "ok") {
        span.style.backgroundColor = "#0f5132";
        span.style.color = "#d1e7dd";
        span.style.border = "1px solid #146c43";
        span.textContent = "OK";
    } else if (st === "warning" || st === "degradado") {
        span.style.backgroundColor = "#664d03";
        span.style.color = "#fff3cd";
        span.style.border = "1px solid #997404";
        span.textContent = "WARNING";
    } else if (st === "critical" || st === "crítico" || st === "critico") {
        span.style.backgroundColor = "#842029";
        span.style.color = "#f8d7da";
        span.style.border = "1px solid #b62d3a";
        span.textContent = "CRITICAL";
    } else {
        span.textContent = status || "N/A";
    }
    return span;
}

function createAlertSpan(alerts, isCritical) {
    const span = document.createElement("span");
    span.style.fontSize = "0.85em";
    span.style.fontWeight = "500";
    if (alerts) {
        span.style.color = isCritical ? "#ea868f" : "#ffda6a";
        span.textContent = "⚠️ " + alerts;
    } else {
        span.style.color = "#6c757d";
        span.textContent = "-";
    }
    return span;
}

const rows = pages.map(p => {
    // RAM Progress Bar
    let ramEl = "N/A";
    if (p.ram_used !== undefined && p.ram_total !== undefined) {
        ramEl = createProgressBar(p.ram_used, p.ram_total, false, `${p.ram_used}/${p.ram_total} GiB`);
    }

    // Disk Progress Bar
    let diskEl = "N/A";
    if (p.disk_used_pct !== undefined) {
        let label = `${p.disk_used_pct}%`;
        if (p.disk_free_gb !== undefined) {
            label += ` (${p.disk_free_gb}G free)`;
        }
        diskEl = createProgressBar(p.disk_used_pct, 100, true, label);
    }

    // Status
    const statusEl = createStatusBadge(p.status);

    // Alerts
    const isCritical = p.disk_used_pct >= 90 || (p.status || "").toLowerCase() === "critical";
    const alertEl = createAlertSpan(p.alerts, isCritical);

    // Uptime
    let uptimeStr = "N/A";
    if (p.uptime_days !== undefined) {
        uptimeStr = `${p.uptime_days} días`;
    }

    // Ollama RAM
    let ollamaStr = "N/A";
    if (p.ollama_ram_gb !== undefined) {
        ollamaStr = `${p.ollama_ram_gb} GiB`;
    }

    // PM2 count
    let pm2Str = "N/A";
    if (p.pm2_active !== undefined) {
        pm2Str = `${p.pm2_active} proc`;
    }

    return [
        p.file.link,
        p.cpu_load || "N/A",
        ramEl,
        ollamaStr,
        diskEl,
        pm2Str,
        uptimeStr,
        statusEl,
        alertEl
    ];
});

dv.table(
    ["Fecha", "CPU Load", "RAM (Usada/Total)", "Ollama RAM", "Disco % (Libre)", "PM2 Active", "Uptime", "Estado", "Alertas"], 
    rows
);
```
