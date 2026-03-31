import axios from "axios";

const LOGIN_URL = "http://10.68.100.62/mycim2/open-api/auth/login";

type LoginRequest = {
    userId: string;
    password: string;
};

type LoginResponse = {
    msg: string;
    data: {
        departmentId: string | null;
        userRrn: number;
        language: string;
        department: string;
        facility: number;
        token: string;
        username: string;
    } | null;
    success: boolean;
};

const DEFAULT_LOGIN_PAYLOAD = {
    facilityId: "FAB1",
    language: "ZH",
} as const;

export const signInHttp = async (payload: LoginRequest): Promise<LoginResponse> => {
    const response = await axios.post<LoginResponse>(LOGIN_URL, {
        ...DEFAULT_LOGIN_PAYLOAD,
        ...payload,
    }, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
        },
        timeout: 10000,
    });

    return response.data;
};
