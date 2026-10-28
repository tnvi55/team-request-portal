'use client';

import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };

/**
 * A password field with a Show/Hide toggle. The button's name is just "Show"/"Hide" (with
 * aria-controls and aria-pressed), so the field keeps its own label: "Password" still finds only
 * the input. Typing stays in the input; the value is never copied anywhere else.
 */
export function PasswordInput({ id, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input id={id} {...props} type={visible ? 'text' : 'password'} spellCheck={false} />
      <button
        type="button"
        className="password-toggle"
        aria-controls={id}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
