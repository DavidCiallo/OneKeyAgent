import { registerUser } from "../modules/auth/auth.service";
import { config } from "dotenv";
config();

export async function initialize() {
    if (process.env.ADMIN_NAME && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        await registerUser(
            process.env.ADMIN_NAME,
            process.env.ADMIN_EMAIL,
            process.env.ADMIN_PASSWORD
        );
    }
}