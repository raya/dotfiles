-- Pull in the wezterm API
local wezterm = require 'wezterm'

-- This will hold the configuration.
local config = wezterm.config_builder()

config.color_scheme = 'Atom'
config.font_size = 14.0

-- Window
-- Sets the font for the window frame (tab bar)
config.window_frame = {
    font_size = 15
}

config.window_decorations = "RESIZE"

config.adjust_window_size_when_changing_font_size = false
config.enable_scroll_bar = true

config.keys = {
    

}

return config
