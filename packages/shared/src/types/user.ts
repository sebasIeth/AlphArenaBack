export interface User {
  id: string;
  walletAddress: string;
  username: string;
  email: string | null;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterInput {
  username: string;
  password: string;
  walletAddress: string;
  email?: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthPayload {
  userId: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, "id"> & { id: string };
}
