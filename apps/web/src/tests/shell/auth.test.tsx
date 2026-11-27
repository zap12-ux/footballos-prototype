import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness';
import { DEMO_MFA_CODE } from '../fakeApi';

describe('auth gating and sign-in', () => {
  it('redirects an unauthenticated visitor from /app/* to /sign-in and remembers where they were going', async () => {
    const { router } = renderApp('/app/schedule?unit=defense');
    expect(await screen.findByRole('heading', { level: 1, name: /^Sign in$/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/app/schedule?unit=defense');
    expect(screen.queryByRole('heading', { name: /^Schedule$/ })).not.toBeInTheDocument();
    // No self-registration path: the first head coach is created by the server CLI.
    expect(screen.queryByRole('link', { name: /sign up|create account|register/i })).not.toBeInTheDocument();
  });

  it('rejects a wrong password with a visible error and stays on the form', async () => {
    const user = userEvent.setup();
    renderApp('/sign-in');
    await screen.findByRole('heading', { level: 1, name: /^Sign in$/ });
    await user.type(screen.getByLabelText(/^Email$/), 'head.coach@winchester-hawks.demo');
    await user.type(screen.getByLabelText(/^Password$/), 'wrong');
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(screen.getByRole('heading', { level: 1, name: /^Sign in$/ })).toBeInTheDocument();
  });

  it('signs in with email, password and an MFA code, then returns to the requested page', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app/schedule');
    await screen.findByRole('heading', { level: 1, name: /^Sign in$/ });
    await user.type(screen.getByLabelText(/^Email$/), 'head.coach@winchester-hawks.demo');
    await user.type(screen.getByLabelText(/^Password$/), 'demo');
    await user.click(screen.getByRole('button', { name: /^Sign in$/ }));

    expect(await screen.findByRole('heading', { level: 1, name: /Verification code/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Code$/), '000000');
    await user.click(screen.getByRole('button', { name: /^Verify$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);

    await user.clear(screen.getByLabelText(/^Code$/));
    await user.type(screen.getByLabelText(/^Code$/), DEMO_MFA_CODE);
    await user.click(screen.getByRole('button', { name: /^Verify$/ }));

    expect(await screen.findByRole('heading', { level: 1, name: /^Schedule$/ })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/schedule'));
    expect(screen.getByTestId('signed-in-as')).toHaveTextContent(/Dana Whitlock/);
  });

  it('offers account recovery without revealing whether an account exists', async () => {
    const user = userEvent.setup();
    renderApp('/sign-in');
    await screen.findByRole('heading', { level: 1, name: /^Sign in$/ });
    await user.click(screen.getByRole('button', { name: /Can.t sign in/i }));
    expect(screen.getByRole('heading', { level: 1, name: /Account recovery/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Email$/), 'nobody@winchester-hawks.demo');
    await user.click(screen.getByRole('button', { name: /Send recovery link/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /Check your email/ })).toBeInTheDocument();
    expect(screen.getByText(/If an account exists/)).toBeInTheDocument();
  });

  it('signs out from the workspace and gates the next visit', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app/staff', { signedInAs: 'user-head' });
    await screen.findByRole('heading', { level: 1, name: /^Staff$/ });
    await user.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Sign in$/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});
