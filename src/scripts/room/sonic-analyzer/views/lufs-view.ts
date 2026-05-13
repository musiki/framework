const HISTORY_LEN = 80;

function lufsToChar(lufs: number): string {
  if (lufs < -40) return '_';
  if (lufs < -24) return '.';
  if (lufs < -14) return '-';
  return '‾';
}

function lufsColor(lufs: number): string {
  if (lufs > -9) return 'clip';
  if (lufs > -14) return 'warn';
  return 'ok';
}

export class LufsHistory {
  public history: number[] = [];

  push(lufsM: number): void {
    this.history.push(lufsM);
    if (this.history.length > HISTORY_LEN) this.history.shift();
  }

  render(el: HTMLElement, lufsM: number, lufsS: number, lufsI: number): void {
    const mCls = lufsColor(lufsM);
    const sCls = lufsColor(lufsS);
    const iCls = lufsColor(lufsI);

    const envelope = this.history.map(v => lufsToChar(v)).join('');
    const padding = ' '.repeat(Math.max(0, HISTORY_LEN - this.history.length));

    el.innerHTML = [
      `<span class="sa-key">M </span><span class="sa-${mCls}">${lufsM.toFixed(1).padStart(6)}</span>  <span class="sa-key">S </span><span class="sa-${sCls}">${lufsS.toFixed(1).padStart(6)}</span>  <span class="sa-key">I </span><span class="sa-${iCls}">${lufsI.toFixed(1).padStart(6)}</span>  <span class="sa-dim">LUFS</span>`,
      `<span class="sa-dim">${'─'.repeat(HISTORY_LEN)}</span>`,
      `<span class="sa-history">${padding}${envelope}</span>`,
      `<span class="sa-dim">${'▲'.padStart(HISTORY_LEN)}  now</span>`,
    ].join('\n');
  }
}
