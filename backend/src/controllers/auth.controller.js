import { User } from "../models/user.models.js";

export const signUp = async (req, res) => {
    try {
        const { userId, password } = req.body;
        if([userId, password].some((field) => typeof field !== "string" || field.trim() === "")) {
            return res.status(400).send({ status: false, message: "Missing Fields" });
        };

        const isUserExist = await User.findOne({ userId });
        if (isUserExist) {
            return res.status(409).send({ status: false, message: "User already exists" });
        }

        // Create the user and save in DB
        await User.create({ userId, password });
        res.status(201).send({ status: true, message: "User created successfully" });

    } catch (error) {
        return res.status(500).send({status: false, message: error.message}); 
    };
};



export const signIn = async (req, res) => {
    try {
        const { userId, password } = req.body;

        if([userId, password].some((field) => typeof field !== "string" || field.trim() === "")) {
            return res.status(400).send({ status: false, message: "Missing Fields" });
        };

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({ status: false, message: "Invalid Credentials" });
        }

        const isPasswordValid = await user.isPasswordCorrect(password);

        if (!isPasswordValid) {
            return res.status(401).json({ status: false, message: "Incorrect password" });
        }

        const userResponse = { userId: user.userId, name: user.userId };
        return res.status(200).json({ status: true, message: "Login successful", user: userResponse });

    } catch (error) {
        return res.status(500).json({ status: false, message: error.message });
    }
};
