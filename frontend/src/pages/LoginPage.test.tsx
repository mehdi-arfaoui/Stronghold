import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const { loginMock, getPendingSetupEmailMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  getPendingSetupEmailMock: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: loginMock,
    logout: vi.fn(),
    changePassword: vi.fn(),
  }),
}));

vi.mock('@/lib/authSession', () => ({
  getPendingSetupEmail: getPendingSetupEmailMock,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingSetupEmailMock.mockReturnValue(null);
    loginMock.mockResolvedValue(undefined);
  });

  it('submits the current form values even when browser autofill did not trigger React change events', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Mot de passe') as HTMLInputElement;
    const submitButton = screen.getByRole('button', { name: /se connecter/i });
    const form = submitButton.closest('form');

    expect(form).not.toBeNull();

    emailInput.value = 'admin@stronghold.local';
    passwordInput.value = 'super-secret';

    await user.click(submitButton);

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin@stronghold.local', 'super-secret');
    });
    expect(screen.queryByText('Email et mot de passe requis.')).not.toBeInTheDocument();
  });

  it('shows a validation error when one of the fields is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'admin@stronghold.local');
    const form = screen.getByRole('button', { name: /se connecter/i }).closest('form');

    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(loginMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Email et mot de passe requis.')).toBeInTheDocument();
  });

  it('syncs state from input events emitted by browser autofill flows', async () => {
    render(<LoginPage />);

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Mot de passe') as HTMLInputElement;

    fireEvent.input(emailInput, { target: { value: 'autofill@stronghold.local' } });
    fireEvent.input(passwordInput, { target: { value: 'autofill-password' } });

    expect(emailInput.value).toBe('autofill@stronghold.local');
    expect(passwordInput.value).toBe('autofill-password');
  });
});
