import {useLayoutEffect,type RefObject} from 'react';

/** Owned by the phone shell so a save/cancel during dismissal cannot reveal its dock early. */
export function useContactEditorDock() {
  useLayoutEffect(()=>{
    const shell=document.getElementById('root');
    if(!shell)return;
    const html=document.documentElement,viewport=window.visualViewport;
    let timer=0,fullHeight=0;
    const clear=()=>shell.removeAttribute('data-contact-dock-hidden');
    function atRest() {
      if(html.dataset.keyboardOpen==='true')return false;
      if(!viewport || Math.abs(viewport.scale-1)>.01)return true;
      const available=Math.min(fullHeight,Math.max(html.clientHeight,window.innerHeight));
      return viewport.height>=available-2 && Math.abs(viewport.offsetTop)<=2 &&
        Math.abs(viewport.pageTop-window.scrollY)<=2;
    }
    function update() {
      if(!shell)return;
      const open=html.dataset.keyboardOpen==='true';
      if(!shell.hasAttribute('data-contact-dock-hidden')){
        if(!open || !document.querySelector('.call-contact-editor'))return;
        fullHeight=parseFloat(html.style.getPropertyValue('--height')) || window.innerHeight;
        shell.setAttribute('data-contact-dock-hidden','');
      }
      window.clearTimeout(timer);
      if(document.activeElement?.closest('.phone-dock')){clear();return}
      if(open)return;
      // Safari can restore the height before it restores the pan, or briefly
      // report both as zero mid-animation. Restart the quiet interval on each change.
      timer=window.setTimeout(()=>{if(atRest())clear()},200);
    }
    const state=new MutationObserver(update);
    state.observe(html,{attributes:true,attributeFilter:['data-keyboard-open']});
    viewport?.addEventListener('resize',update);
    viewport?.addEventListener('scroll',update);
    window.addEventListener('scroll',update,{passive:true});
    window.addEventListener('pageshow',update);
    document.addEventListener('focusin',update);
    update();
    return ()=>{
      window.clearTimeout(timer);state.disconnect();clear();
      viewport?.removeEventListener('resize',update);
      viewport?.removeEventListener('scroll',update);
      window.removeEventListener('scroll',update);
      window.removeEventListener('pageshow',update);
      document.removeEventListener('focusin',update);
    };
  },[]);
}

/** Coordinate native focus, keyboard occlusion and this editor's single scroll area. */
export function useContactEditorViewport(dialog:RefObject<HTMLElement|null>,keyboardSlot:RefObject<HTMLDivElement|null>,step:string) {
  useLayoutEffect(() => {
    const panel=dialog.current?.querySelector<HTMLElement>('.ios-editor-scroll');
    if(!panel)return;
    let frame=0;
    let anchor:{field:HTMLInputElement,top:number}|undefined;
    let tap:{field:HTMLInputElement,id:number,x:number,y:number,at:number}|undefined;
    let heldTop:number|null=null;
    let unlockTimer=0;
    function unlock() {
      window.clearTimeout(unlockTimer);
      if(heldTop===null || !panel)return;
      const top=heldTop;
      heldTop=null;
      // Restore native scrolling and its offset in the same task, before paint.
      panel.removeAttribute('data-hold-position');
      panel.style.removeProperty('--held-fields-offset');
      panel.scrollTop=top;
    }
    function hold() {
      if(!anchor || !panel || (viewport && Math.abs(viewport.scale-1)>.01))return;
      if(heldTop===null){
        heldTop=anchor.top;
        panel.scrollTop=0;
        panel.style.setProperty('--held-fields-offset',-heldTop+'px');
        panel.setAttribute('data-hold-position','');
      }
      window.clearTimeout(unlockTimer);
      unlockTimer=window.setTimeout(unlock,700);
    }
    const viewport=window.visualViewport;
    let lastPageTop:number|undefined;
    function placeEditor() {
      if(viewport && Math.abs(viewport.scale-1)>.01)return;
      const top=viewport?.pageTop ?? (window.scrollY+(viewport?.offsetTop??0));
      if(Number.isFinite(top) && top!==lastPageTop){
        lastPageTop=top;
        document.body.style.setProperty('--editor-page-top',top+'px');
      }
    }

    function remember(field:EventTarget|null) {
      if(field instanceof HTMLInputElement && panel?.contains(field)){
        const top=heldTop??panel.scrollTop;
        anchor={field,top};
        // A shorter keyboard can otherwise shrink the scroll range and clamp a
        // previously visible, bottom-scrolled row before the next animation frame.
        if(keyboardSlot.current?.offsetHeight)panel.style.setProperty('--preserved-scroll',top+'px');
      }
    }
    function inputAt(target:EventTarget|null) {
      if(!(target instanceof Element))return null;
      const field=target.closest('input') ?? target.closest('label')?.control;
      return field instanceof HTMLInputElement && !field.disabled && !field.readOnly ? field : null;
    }
    function beforeFocus(event:PointerEvent) {
      // Give a new touch or selection gesture the ordinary scroll surface immediately.
      unlock();
      tap=undefined;
      const field=inputAt(event.target);
      if(!field || !event.isPrimary || event.button!==0 || event.defaultPrevented){release();return}
      remember(field);
      if(document.activeElement===field)return;
      if(event.pointerType==='mouse'){hold();field.focus({preventScroll:true})}
      else tap={field,id:event.pointerId,x:event.clientX,y:event.clientY,at:event.timeStamp};
    }
    function finishTap(event:PointerEvent) {
      const start=tap;
      tap=undefined;
      if(!start || start.id!==event.pointerId || event.defaultPrevented || event.timeStamp-start.at>500 ||
          Math.hypot(event.clientX-start.x,event.clientY-start.y)>8 || start.field!==inputAt(event.target))return;
      // A touch release carries user activation. Focus before WebKit performs its
      // automatic reveal. The default click still places the caret at the tapped character.
      if(document.activeElement!==start.field){hold();start.field.focus({preventScroll:true})}
    }
    function onFocus(event:FocusEvent) {
      if(anchor?.field!==event.target)remember(event.target);
      geometryChanged();
    }
    function release() {unlock();anchor=undefined;tap=undefined}
    function onWheel(event:WheelEvent) {
      const wasHeld=heldTop!==null;
      release();
      if(!panel || !wasHeld || !event.cancelable || event.defaultPrevented || event.ctrlKey || event.metaKey ||
          event.shiftKey || Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
      // The compositor chose its target while the panel was clipped. Apply this
      // first wheel step here. Subsequent wheel events use ordinary native scroll.
      const unit=event.deltaMode===WheelEvent.DOM_DELTA_PAGE?panel.clientHeight:
        event.deltaMode===WheelEvent.DOM_DELTA_LINE?(parseFloat(getComputedStyle(panel).lineHeight)||16):1;
      const next=Math.max(0,Math.min(panel.scrollTop+event.deltaY*unit,panel.scrollHeight-panel.clientHeight));
      if(Math.abs(next-panel.scrollTop)<0.01)return;
      event.preventDefault();
      panel.scrollTop=next;
    }
    function revealField() {
      frame=0;
      if(!panel)return;
      if(!keyboardSlot.current?.offsetHeight)panel.style.removeProperty('--preserved-scroll');
      if(!anchor || !anchor.field.isConnected)return;
      const {field,top}=anchor;
      let target=top;
      if(field===document.activeElement){
        const bounds=panel.getBoundingClientRect();
        const row=field.getBoundingClientRect();
        const rowTop=row.top-bounds.top+(heldTop??panel.scrollTop);
        // Keep the pre-focus scroll position unless a keyboard or candidate bar covers the field.
        target=Math.max(rowTop+row.height+8-bounds.height,Math.min(top,rowTop-8));
      } else {
        if(document.documentElement.dataset.keyboardOpen==='true')return;
        release();
      }
      if(heldTop!==null){
        // The panel cannot be scrolled by WebKit while clipped. Offset the actual
        // fields only if the focused row would be obscured, including on small screens.
        target=Math.max(0,target);
        if(Math.abs(target-heldTop)>1){
          heldTop=target;
          panel.style.setProperty('--held-fields-offset',-target+'px');
        }
      } else {
        target=Math.max(0,Math.min(target,panel.scrollHeight-panel.clientHeight));
        if(Math.abs(target-panel.scrollTop)>1)panel.scrollTop=target;
      }
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(revealField)};
    const geometryChanged=()=>{placeEditor();hold();schedule()};
    const resize=new ResizeObserver(geometryChanged);
    resize.observe(panel);
    panel.addEventListener('pointerdown',beforeFocus,true);
    panel.addEventListener('pointerup',finishTap,true);
    panel.addEventListener('pointercancel',release);
    panel.addEventListener('focusin',onFocus);
    panel.addEventListener('focusout',schedule);
    panel.addEventListener('touchmove',release,{passive:true});
    panel.addEventListener('wheel',onWheel,{passive:false,capture:true});
    window.addEventListener('scroll',geometryChanged,{passive:true});
    viewport?.addEventListener('resize',geometryChanged);
    viewport?.addEventListener('scroll',geometryChanged);
    remember(document.activeElement);
    geometryChanged();
    return ()=>{
      cancelAnimationFrame(frame);resize.disconnect();unlock();
      panel.removeEventListener('pointerdown',beforeFocus,true);
      panel.removeEventListener('pointerup',finishTap,true);
      panel.removeEventListener('pointercancel',release);
      panel.removeEventListener('focusin',onFocus);
      panel.removeEventListener('focusout',schedule);
      panel.removeEventListener('touchmove',release);
      panel.removeEventListener('wheel',onWheel,true);
      window.removeEventListener('scroll',geometryChanged);
      document.body.style.removeProperty('--editor-page-top');
      viewport?.removeEventListener('resize',geometryChanged);
      viewport?.removeEventListener('scroll',geometryChanged);
    };
  },[dialog,keyboardSlot,step]);
}
