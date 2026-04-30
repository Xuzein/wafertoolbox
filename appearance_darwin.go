//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

void SetNSAppearance(const char* theme) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSAppearance *appearance = nil;
        NSString *t = [NSString stringWithUTF8String:theme];
        if ([t isEqualToString:@"dark"]) {
            if (@available(macOS 10.14, *)) {
                appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
            }
        } else if ([t isEqualToString:@"light"]) {
            appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
        }
        // nil = follow system default
        [NSApp.mainWindow setAppearance:appearance];
    });
}
*/
import "C"

func setMacAppearance(theme string) {
	C.SetNSAppearance(C.CString(theme))
}
