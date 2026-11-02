import {useId, useState} from 'react';
import {PhoneIcon} from './PhoneIcon';
import './phone-number-pad.css';

type PhoneNumberPadProps = {
  onInsert: (value: string) => void;
  onDelete: () => void;
  onDismiss: () => void;
};

const letters = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
const symbols = [
  {value: '+', label: '加号'},
  {value: '*', label: '星号'},
  {value: '#', label: '井号'},
];

export function PhoneNumberPad({onInsert, onDelete, onDismiss}: PhoneNumberPadProps) {
  const [showSymbols, setShowSymbols] = useState(false);
  const symbolGroup = useId();

  return <div className="phone-number-pad" role="group" aria-label="电话号码键盘"
    onPointerDown={event => {
      // Keep the telephone input's caret and selection during a tap. Native
      // button clicks (including keyboard and assistive-technology activation) still work.
      if (event.isPrimary && event.button === 0) event.preventDefault();
    }}>
    {letters.map((caption, index) => {
      const digit = String(index + 1);
      return <button key={digit} type="button" aria-label={digit} onClick={() => onInsert(digit)}>
        <span className="phone-number-pad-digit">{digit}</span>
        <span aria-hidden="true" className="phone-number-pad-letters">{caption}</span>
      </button>;
    })}
    <div className="phone-number-pad-switch">
      <button type="button" className="phone-number-pad-action" aria-expanded={showSymbols}
        aria-controls={showSymbols ? symbolGroup : undefined}
        aria-label={showSymbols ? '返回数字键盘' : '切换到符号键盘'}
        onClick={() => setShowSymbols(open => !open)}>{showSymbols ? '123' : '+*#'}</button>
      {showSymbols && <div id={symbolGroup} role="group" aria-label="电话号码符号" className="phone-number-pad-symbols">
        {symbols.map(({value, label}) =>
          <button key={value} type="button" aria-label={label} onClick={() => onInsert(value)}>{value}</button>)}
      </div>}
    </div>
    <button type="button" aria-label="0" onClick={() => onInsert('0')}><span className="phone-number-pad-digit">0</span></button>
    <div className="phone-number-pad-actions">
      <button type="button" className="phone-number-pad-action" aria-label="退格" onClick={onDelete}>
        <PhoneIcon name="delete" size={23}/>
      </button>
      <button type="button" className="phone-number-pad-action" aria-label="收起键盘" onClick={onDismiss}>
        <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.1" y="3.8" width="19.8" height="12" rx="2.5"/>
          <path d="M5.7 7.7h.5m2.6 0h.5m2.5 0h.5m2.5 0h.5m2.5 0h.5m-11 4.1h9.2M9 18.6l3 2.6 3-2.6"/>
        </svg>
      </button>
    </div>
  </div>;
}
