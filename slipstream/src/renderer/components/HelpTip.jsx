import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Keep explanations outside scroll containers so a compact window cannot clip them.
export default function HelpTip({ label, children }) {
  const id = useId();
  const triggerRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const gap = 8;
      const left = Math.max(gap, Math.min(anchor.right - tip.width, window.innerWidth - tip.width - gap));
      const below = anchor.bottom;
      const top = below + tip.height <= window.innerHeight - gap
        ? below : Math.max(gap, Math.min(anchor.top - tip.height, window.innerHeight - tip.height - gap));
      setPosition({ left, top });
    };
    place();
    const dismiss = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);


  return (
    <span className="help-tip"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button ref={triggerRef} type="button" className="help-tip__trigger"
        aria-label={label} aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      ><span aria-hidden="true">?</span></button>
      {createPortal(
        <span ref={tipRef} id={id} role="tooltip" hidden={!open} className="help-tip__content"
          style={position}
        >{children}</span>, document.body,
      )}
    </span>
  );
}
